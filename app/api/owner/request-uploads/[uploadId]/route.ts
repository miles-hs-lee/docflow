import { NextResponse } from 'next/server';

import { requireOwner } from '@/lib/auth';
import { getRequestUpload, signedRequestObjectUrl } from '@/lib/data';

// Owner-only download of a file-request upload. requireOwner redirects to /login
// when unauthenticated; getRequestUpload runs under the RLS client so an owner
// can only ever resolve their own upload. We 302 to a short-lived signed URL.
export async function GET(_request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = await params;
  const { supabase } = await requireOwner();

  const upload = await getRequestUpload(supabase, uploadId);
  if (!upload) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = await signedRequestObjectUrl(upload.storage_path, 60);
  if (!url) {
    return NextResponse.json({ error: 'unavailable' }, { status: 500 });
  }

  return NextResponse.redirect(url, { status: 302 });
}
