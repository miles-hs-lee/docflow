import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { removeLogoObject, uploadLogoObject } from '@/lib/data';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { fileExtension, magicByteMatches } from '@/lib/upload-validation';

export const maxDuration = 30;

const MAX_LOGO_BYTES = 2097152;

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml'
};

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

// Owner-only per-data-room logo upload → collection_branding.logo_path. Reuses
// the public owner-logos bucket (path prefixed room-${collectionId}-).
export async function POST(request: Request, { params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return bad(401, 'unauthorized');

  const admin = createAdminClient();
  const { data: owned } = await admin
    .from('collections')
    .select('id')
    .eq('id', collectionId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!owned) return bad(403, 'forbidden');

  const formData = await request.formData();
  const uploaded = formData.get('logo');
  if (!(uploaded instanceof File) || uploaded.size === 0) return bad(400, 'no_file');
  const file = uploaded as File;
  if (file.size > MAX_LOGO_BYTES) return bad(413, 'too_large');

  const ext = fileExtension(file.name);
  const contentType = EXT_TO_MIME[ext];
  if (!contentType) return bad(415, 'unsupported_type');

  const header = Buffer.from(await file.slice(0, 8).arrayBuffer());
  if (!magicByteMatches(header, contentType)) return bad(415, 'unsupported_type');

  const { data: existing } = await admin
    .from('collection_branding')
    .select('logo_path')
    .eq('collection_id', collectionId)
    .maybeSingle();
  const oldPath = (existing as { logo_path: string | null } | null)?.logo_path ?? null;

  const path = `${user.id}/room-${collectionId}-${crypto.randomUUID()}.${ext}`;
  try {
    await uploadLogoObject({ path, file, contentType });
  } catch {
    return bad(500, 'storage_failed');
  }

  const { error: upsertError } = await admin
    .from('collection_branding')
    .upsert({ collection_id: collectionId, owner_id: user.id, logo_path: path }, { onConflict: 'collection_id' });
  if (upsertError) {
    try {
      await removeLogoObject(path);
    } catch {
      // ignore
    }
    return bad(500, 'save_failed');
  }

  if (oldPath && oldPath !== path) {
    try {
      await removeLogoObject(oldPath);
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ ok: true });
}
