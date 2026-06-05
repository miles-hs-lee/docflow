import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { removeLogoObject, uploadLogoObject } from '@/lib/data';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;

const MAX_LOGO_BYTES = 2097152; // 2MB, matches the owner-logos bucket

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

// Owner-only logo upload. Manual auth (not requireOwner) so an unauthenticated
// fetch gets a 401 JSON instead of a redirect-to-login the client can't parse.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return bad(401, 'unauthorized');

  const formData = await request.formData();
  const uploaded = formData.get('logo');
  if (!(uploaded instanceof File) || uploaded.size === 0) return bad(400, 'no_file');
  const file = uploaded as File;
  if (file.size > MAX_LOGO_BYTES) return bad(413, 'too_large');

  const ext = (file.name.includes('.') ? file.name.split('.').pop() : '')?.toLowerCase() ?? '';
  const contentType = EXT_TO_MIME[ext];
  if (!contentType) return bad(415, 'unsupported_type');

  // Magic-byte check for raster types (svg/webp rely on ext + bucket MIME).
  if (contentType === 'image/png' || contentType === 'image/jpeg') {
    const head = Buffer.from(await file.slice(0, 4).arrayBuffer());
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (contentType === 'image/png' && !isPng) return bad(415, 'unsupported_type');
    if (contentType === 'image/jpeg' && !isJpg) return bad(415, 'unsupported_type');
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('owner_branding')
    .select('logo_path')
    .eq('owner_id', user.id)
    .maybeSingle();
  const oldPath = (existing as { logo_path: string | null } | null)?.logo_path ?? null;

  // Random suffix so the public URL changes on each upload (cache-bust).
  const path = `${user.id}/logo-${crypto.randomUUID()}.${ext}`;
  try {
    await uploadLogoObject({ path, file, contentType });
  } catch {
    return bad(500, 'storage_failed');
  }

  // Upsert only logo_path → existing company_name / brand_color are preserved.
  const { error: upsertError } = await admin
    .from('owner_branding')
    .upsert({ owner_id: user.id, logo_path: path }, { onConflict: 'owner_id' });
  if (upsertError) {
    try {
      await removeLogoObject(path); // compensate
    } catch {
      // ignore
    }
    return bad(500, 'save_failed');
  }

  if (oldPath && oldPath !== path) {
    try {
      await removeLogoObject(oldPath); // best-effort cleanup of the replaced logo
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ ok: true });
}
