import crypto from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { uploadPdfObject } from '@/lib/data';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function redirectToDashboard(requestUrl: string, key: 'error' | 'success', message: string) {
  const url = new URL('/dashboard', requestUrl);
  url.searchParams.set(key, message);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  }

  const admin = createAdminClient();
  const formData = await request.formData();
  const uploaded = formData.get('pdf');

  if (!(uploaded instanceof File) || uploaded.size === 0) {
    return redirectToDashboard(request.url, 'error', 'PDF 파일을 선택해주세요.');
  }

  const file = uploaded as File;
  const isPdfMime = file.type === 'application/pdf';
  const isPdfExt = file.name.toLowerCase().endsWith('.pdf');

  if (!isPdfMime && !isPdfExt) {
    return redirectToDashboard(request.url, 'error', 'PDF 파일만 업로드할 수 있습니다.');
  }

  const fileId = crypto.randomUUID();
  const safeName = sanitizeFileName(file.name || `${fileId}.pdf`);
  const storagePath = `${user.id}/${fileId}/${safeName}`;

  const { error: insertError } = await admin.from('files').insert({
    id: fileId,
    owner_id: user.id,
    original_name: file.name,
    mime_type: 'application/pdf',
    size_bytes: file.size,
    storage_path: storagePath
  });

  if (insertError) {
    return redirectToDashboard(request.url, 'error', '파일 메타데이터 저장에 실패했습니다.');
  }

  try {
    await uploadPdfObject({ path: storagePath, file });
  } catch {
    await admin.from('files').delete().eq('id', fileId).eq('owner_id', user.id);
    return redirectToDashboard(request.url, 'error', '스토리지 업로드에 실패했습니다.');
  }

  revalidatePath('/dashboard');
  return redirectToDashboard(request.url, 'success', 'PDF 업로드가 완료되었습니다.');
}
