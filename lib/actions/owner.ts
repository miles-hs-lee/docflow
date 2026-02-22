'use server';

import crypto from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireOwner } from '@/lib/auth';
import { removePdfObject, uploadPdfObject } from '@/lib/data';
import { generateShareToken, hashPassword, parseAllowedDomains } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';

function parseBoolean(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === 'on' || value === 'true' || value === '1';
}

function parseOptionalInt(formData: FormData, key: string) {
  const raw = (formData.get(key) as string | null)?.trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseOptionalDate(formData: FormData, key: string) {
  const raw = (formData.get(key) as string | null)?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toISOString();
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function uploadPdfAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const uploaded = formData.get('pdf');
  if (!(uploaded instanceof File) || uploaded.size === 0) {
    redirect('/dashboard?error=PDF%20파일을%20선택해주세요.');
  }

  const file = uploaded as File;
  const isPdfMime = file.type === 'application/pdf';
  const isPdfExt = file.name.toLowerCase().endsWith('.pdf');

  if (!isPdfMime && !isPdfExt) {
    redirect('/dashboard?error=PDF%20파일만%20업로드할%20수%20있습니다.');
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
    redirect('/dashboard?error=파일%20메타데이터%20저장에%20실패했습니다.');
  }

  try {
    await uploadPdfObject({ path: storagePath, file });
  } catch {
    await admin.from('files').delete().eq('id', fileId).eq('owner_id', user.id);
    redirect('/dashboard?error=스토리지%20업로드에%20실패했습니다.');
  }

  revalidatePath('/dashboard');
  redirect('/dashboard?success=PDF%20업로드가%20완료되었습니다.');
}

export async function createShareLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const fileId = (formData.get('fileId') as string | null)?.trim();
  if (!fileId) {
    redirect('/dashboard?error=파일%20정보가%20누락되었습니다.');
  }

  const { data: ownedFile } = await admin
    .from('files')
    .select('id')
    .eq('id', fileId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!ownedFile) {
    redirect('/dashboard?error=파일%20권한이%20없습니다.');
  }

  const label = ((formData.get('label') as string | null) || '').trim();
  if (!label) {
    redirect(`/dashboard/files/${fileId}?error=링크%20이름은%20필수입니다.`);
  }

  const allowedDomains = parseAllowedDomains(((formData.get('allowedDomains') as string | null) || '').trim());
  const requireEmail = parseBoolean(formData, 'requireEmail') || allowedDomains.length > 0;
  const rawPassword = ((formData.get('password') as string | null) || '').trim();
  const passwordHash = rawPassword ? await hashPassword(rawPassword) : null;

  const { error } = await admin.from('share_links').insert({
    file_id: fileId,
    owner_id: user.id,
    label,
    token: generateShareToken(),
    is_active: parseBoolean(formData, 'isActive'),
    expires_at: parseOptionalDate(formData, 'expiresAt'),
    max_views: parseOptionalInt(formData, 'maxViews'),
    require_email: requireEmail,
    allowed_domains: allowedDomains,
    password_hash: passwordHash,
    allow_download: parseBoolean(formData, 'allowDownload'),
    one_time: parseBoolean(formData, 'oneTime')
  });

  if (error) {
    redirect(`/dashboard/files/${fileId}?error=링크%20생성에%20실패했습니다.`);
  }

  revalidatePath(`/dashboard/files/${fileId}`);
  redirect(`/dashboard/files/${fileId}?success=공유%20링크가%20생성되었습니다.`);
}

export async function updateShareLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const linkId = ((formData.get('linkId') as string | null) || '').trim();
  const fileId = ((formData.get('fileId') as string | null) || '').trim();

  if (!linkId || !fileId) {
    redirect('/dashboard?error=링크%20수정에%20필요한%20정보가%20누락되었습니다.');
  }

  const { data: existingLink, error: fetchError } = await admin
    .from('share_links')
    .select('id, password_hash')
    .eq('id', linkId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (fetchError || !existingLink) {
    redirect(`/dashboard/files/${fileId}?error=링크를%20찾을%20수%20없습니다.`);
  }

  const label = ((formData.get('label') as string | null) || '').trim();
  if (!label) {
    redirect(`/dashboard/files/${fileId}?error=링크%20이름은%20필수입니다.`);
  }

  const allowedDomains = parseAllowedDomains(((formData.get('allowedDomains') as string | null) || '').trim());
  const requireEmail = parseBoolean(formData, 'requireEmail') || allowedDomains.length > 0;

  const newPassword = ((formData.get('newPassword') as string | null) || '').trim();
  const clearPassword = parseBoolean(formData, 'clearPassword');

  let passwordHash = existingLink.password_hash;
  if (clearPassword) {
    passwordHash = null;
  } else if (newPassword) {
    passwordHash = await hashPassword(newPassword);
  }

  const { error } = await admin
    .from('share_links')
    .update({
      label,
      is_active: parseBoolean(formData, 'isActive'),
      expires_at: parseOptionalDate(formData, 'expiresAt'),
      max_views: parseOptionalInt(formData, 'maxViews'),
      require_email: requireEmail,
      allowed_domains: allowedDomains,
      password_hash: passwordHash,
      allow_download: parseBoolean(formData, 'allowDownload'),
      one_time: parseBoolean(formData, 'oneTime')
    })
    .eq('id', linkId)
    .eq('owner_id', user.id);

  if (error) {
    redirect(`/dashboard/files/${fileId}?error=링크%20수정에%20실패했습니다.`);
  }

  revalidatePath(`/dashboard/files/${fileId}`);
  revalidatePath(`/dashboard/links/${linkId}`);
  redirect(`/dashboard/files/${fileId}?success=링크%20정책이%20업데이트되었습니다.`);
}

export async function softDeleteLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const linkId = ((formData.get('linkId') as string | null) || '').trim();
  const fileId = ((formData.get('fileId') as string | null) || '').trim();

  if (!linkId || !fileId) {
    redirect('/dashboard?error=삭제할%20링크를%20확인할%20수%20없습니다.');
  }

  const { error } = await admin
    .from('share_links')
    .update({
      deleted_at: new Date().toISOString(),
      is_active: false
    })
    .eq('id', linkId)
    .eq('owner_id', user.id)
    .is('deleted_at', null);

  if (error) {
    redirect(`/dashboard/files/${fileId}?error=링크%20삭제에%20실패했습니다.`);
  }

  revalidatePath(`/dashboard/files/${fileId}`);
  revalidatePath('/dashboard/trash');
  redirect(`/dashboard/files/${fileId}?success=링크가%20휴지통으로%20이동했습니다.`);
}

export async function restoreLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const linkId = ((formData.get('linkId') as string | null) || '').trim();

  if (!linkId) {
    redirect('/dashboard/trash?error=복구할%20링크를%20확인할%20수%20없습니다.');
  }

  const { data: link, error: fetchError } = await admin
    .from('share_links')
    .select('id, file_id')
    .eq('id', linkId)
    .eq('owner_id', user.id)
    .not('deleted_at', 'is', null)
    .maybeSingle();

  if (fetchError || !link) {
    redirect('/dashboard/trash?error=복구할%20링크를%20찾을%20수%20없습니다.');
  }

  const { error } = await admin
    .from('share_links')
    .update({
      deleted_at: null,
      is_active: true
    })
    .eq('id', linkId)
    .eq('owner_id', user.id);

  if (error) {
    redirect('/dashboard/trash?error=링크%20복구에%20실패했습니다.');
  }

  revalidatePath('/dashboard/trash');
  revalidatePath(`/dashboard/files/${link.file_id}`);
  redirect('/dashboard/trash?success=링크를%20복구했습니다.');
}

export async function hardDeleteLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const linkId = ((formData.get('linkId') as string | null) || '').trim();
  const confirmation = ((formData.get('confirmation') as string | null) || '').trim().toUpperCase();

  if (!linkId) {
    redirect('/dashboard/trash?error=삭제할%20링크를%20확인할%20수%20없습니다.');
  }

  if (confirmation !== 'DELETE') {
    redirect('/dashboard/trash?error=영구%20삭제하려면%20DELETE를%20입력하세요.');
  }

  const { data: link, error: fetchError } = await admin
    .from('share_links')
    .select('id, file_id')
    .eq('id', linkId)
    .eq('owner_id', user.id)
    .not('deleted_at', 'is', null)
    .maybeSingle();

  if (fetchError || !link) {
    redirect('/dashboard/trash?error=영구%20삭제할%20링크를%20찾을%20수%20없습니다.');
  }

  const { error } = await admin.from('share_links').delete().eq('id', linkId).eq('owner_id', user.id);

  if (error) {
    redirect('/dashboard/trash?error=영구%20삭제에%20실패했습니다.');
  }

  revalidatePath('/dashboard/trash');
  revalidatePath(`/dashboard/files/${link.file_id}`);
  redirect('/dashboard/trash?success=링크를%20영구%20삭제했습니다.');
}

export async function deleteFileAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const fileId = ((formData.get('fileId') as string | null) || '').trim();

  if (!fileId) {
    redirect('/dashboard?error=파일%20정보가%20누락되었습니다.');
  }

  const { data: file, error: fileError } = await admin
    .from('files')
    .select('id, storage_path')
    .eq('id', fileId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (fileError || !file) {
    redirect('/dashboard?error=파일을%20찾을%20수%20없습니다.');
  }

  await admin.from('files').delete().eq('id', fileId).eq('owner_id', user.id);
  await removePdfObject(file.storage_path);

  revalidatePath('/dashboard');
  redirect('/dashboard?success=파일과%20연결된%20링크를%20삭제했습니다.');
}
