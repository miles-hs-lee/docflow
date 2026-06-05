import crypto from 'node:crypto';

import { after, NextResponse } from 'next/server';

import { getFileRequestByToken, uploadRequestObject } from '@/lib/data';
import { notifyFileUpload } from '@/lib/notify/file-upload';
import { checkRateLimit } from '@/lib/rate-limit';
import { hashIp, normalizeEmail, sanitizeFileName } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';

// 50MB uploads over slow links can exceed the default function budget.
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 52428800; // matches the request-uploads bucket file_size_limit

// Extension → canonical MIME. Validation is extension-driven (browser file.type
// is unreliable: empty, application/octet-stream, or aliases like
// application/x-zip-compressed). The canonical MIME is what we hand to storage,
// so the bucket's allowed_mime_types check always matches. Files are private and
// only the owner downloads them; they are never executed server-side.
const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

// claim_file_request_upload status → HTTP. 'ok' proceeds.
const CLAIM_STATUS: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: 'not_found' },
  closed: { status: 403, error: 'closed' },
  expired: { status: 403, error: 'expired' },
  limit_reached: { status: 403, error: 'limit_reached' }
};

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Fast-fail before buffering the file. The atomic claim below re-checks
  // active/expiry/limit under a row lock — this is just a cheap early reject.
  const req = await getFileRequestByToken(token);
  if (!req) return bad(404, 'not_found');
  if (!req.is_active) return bad(403, 'closed');
  if (req.expires_at && new Date(req.expires_at) < new Date()) return bad(403, 'expired');

  // Rate-limit per (request + hashed IP) so an anonymous client can't flood
  // storage. hashIp throws only if no salt is configured (guaranteed in prod).
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const ipHash = hashIp(ip);
  const rl = await checkRateLimit('fileRequestUpload', `${req.id}:${ipHash ?? 'unknown'}`);
  if (!rl.allowed) return bad(429, 'too_many');

  const formData = await request.formData();
  const uploaded = formData.get('file');
  if (!(uploaded instanceof File) || uploaded.size === 0) return bad(400, 'no_file');
  const file = uploaded as File;

  if (file.size > MAX_UPLOAD_BYTES) return bad(413, 'too_large');

  // Email gate.
  const rawEmail = ((formData.get('email') as string | null) || '').trim();
  if (req.require_email && (!rawEmail || !rawEmail.includes('@'))) return bad(400, 'email_required');
  const uploaderEmail = rawEmail ? normalizeEmail(rawEmail).slice(0, 200) : null;

  // Extension allowlist → canonical content type.
  const ext = (file.name.includes('.') ? file.name.split('.').pop() : '')?.toLowerCase() ?? '';
  const contentType = EXT_TO_MIME[ext];
  if (!contentType) return bad(415, 'unsupported_type');

  // PDF gets a magic-byte check (the one type we render/preview). Other types
  // rely on the extension allowlist + the bucket MIME backstop.
  if (contentType === 'application/pdf') {
    const header = Buffer.from(await file.slice(0, 5).arrayBuffer());
    if (header.toString('binary') !== '%PDF-') return bad(415, 'unsupported_type');
  }

  const admin = createAdminClient();
  const uploadId = crypto.randomUUID();
  const safeName = sanitizeFileName(file.name || uploadId);
  const storagePath = `${req.id}/${uploadId}/${safeName}`;

  // Atomic claim: locks the request row, re-checks active/expiry/max_uploads,
  // and inserts the upload row in one txn — so concurrent uploads cannot exceed
  // the limit (the after-insert trigger bumps upload_count within the same txn).
  const { data: claim, error: claimError } = await admin.rpc('claim_file_request_upload', {
    p_request_id: req.id,
    p_upload_id: uploadId,
    p_uploader_email: uploaderEmail,
    p_original_name: file.name.slice(0, 300),
    p_storage_path: storagePath,
    p_mime_type: contentType,
    p_size_bytes: file.size,
    p_ip_hash: ipHash
  });
  if (claimError) return bad(500, 'save_failed');
  if (claim !== 'ok') {
    const mapped = CLAIM_STATUS[claim as string] ?? { status: 403, error: 'closed' };
    return bad(mapped.status, mapped.error);
  }

  try {
    await uploadRequestObject({ path: storagePath, file, contentType });
  } catch {
    // Compensating delete; the after-delete trigger decrements upload_count.
    await admin.from('file_request_uploads').delete().eq('id', uploadId).eq('owner_id', req.owner_id);
    return bad(500, 'storage_failed');
  }

  // Owner notification runs AFTER the response is flushed (Next `after`), so a
  // slow/broken owner webhook never blocks the visitor. Still best-effort.
  after(() =>
    notifyFileUpload({
      ownerId: req.owner_id,
      requestId: req.id,
      requestTitle: req.title,
      uploadId,
      fileName: file.name,
      uploaderEmail,
      createdAt: new Date().toISOString()
    })
  );

  return NextResponse.json({ ok: true });
}
