import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { removeLogoObject, uploadLogoObject } from '@/lib/data';
import { fileExtension, magicByteMatches } from '@/lib/upload-validation';

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

// Shared core for owner-authorized branding-image upload routes (account logo,
// per-room logo, account/room cover image). The caller authenticates +
// authorizes its scope, then provides the multipart field name, the storage
// path prefix, and how to read / persist the path for that scope. This
// validates (ext + size + magic bytes), uploads to the owner-logos bucket,
// persists, compensates on failure, and cleans up the replaced object. Returns
// a JSON NextResponse.
export async function handleLogoUpload(opts: {
  request: Request;
  /** Multipart field the image arrives under (e.g. 'logo' or 'cover'). */
  field?: string;
  pathPrefix: string;
  loadOldPath: () => Promise<string | null>;
  persist: (path: string) => Promise<{ error: unknown }>;
}): Promise<NextResponse> {
  const formData = await opts.request.formData();
  const uploaded = formData.get(opts.field ?? 'logo');
  if (!(uploaded instanceof File) || uploaded.size === 0) return bad(400, 'no_file');
  const file = uploaded as File;
  if (file.size > MAX_LOGO_BYTES) return bad(413, 'too_large');

  const ext = fileExtension(file.name);
  const contentType = EXT_TO_MIME[ext];
  if (!contentType) return bad(415, 'unsupported_type');

  // Magic-byte check for sniffable types (png/jpeg); svg/webp rely on ext + the
  // bucket's allowed_mime_types backstop.
  const header = Buffer.from(await file.slice(0, 8).arrayBuffer());
  if (!magicByteMatches(header, contentType)) return bad(415, 'unsupported_type');

  const oldPath = await opts.loadOldPath();

  // Random suffix so the public URL changes on each upload (cache-bust).
  const path = `${opts.pathPrefix}${crypto.randomUUID()}.${ext}`;
  try {
    await uploadLogoObject({ path, file, contentType });
  } catch {
    return bad(500, 'storage_failed');
  }

  const { error: persistError } = await opts.persist(path);
  if (persistError) {
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
