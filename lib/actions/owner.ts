'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { MCP_DEFAULT_SCOPES, normalizeMcpScopes } from '@/lib/agent-auth';
import { requireOwner } from '@/lib/auth';
import { removePdfObject } from '@/lib/data';
import {
  generateMcpApiKey,
  generateShareToken,
  getMcpKeyPrefix,
  hashMcpApiKey,
  hashPassword,
  parseAllowedDomains
} from '@/lib/security';
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

function buildRedirectPath(path: string, query: Record<string, string>) {
  const params = new URLSearchParams(query);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

function redirectWithError(path: string, message: string): never {
  redirect(buildRedirectPath(path, { error: message }));
}

function redirectWithSuccess(path: string, message: string): never {
  redirect(buildRedirectPath(path, { success: message }));
}

function getLinkOwnerPath(link: { file_id: string | null; collection_id: string | null }) {
  if (link.collection_id) {
    return `/dashboard/collections/${link.collection_id}`;
  }

  if (link.file_id) {
    return `/dashboard/files/${link.file_id}`;
  }

  return '/dashboard';
}

function readSafeRedirectPath(formData: FormData, fallbackPath: string) {
  const redirectTo = ((formData.get('redirectTo') as string | null) || '').trim();
  if (redirectTo.startsWith('/dashboard')) {
    return redirectTo;
  }

  return fallbackPath;
}

function readSelectedFileIds(formData: FormData) {
  return formData
    .getAll('fileIds')
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}

function readEventTypes(formData: FormData) {
  const listed = formData
    .getAll('eventTypes')
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);

  if (listed.length > 0) {
    return listed;
  }

  return ['view', 'denied', 'email_submitted', 'password_failed', 'download'];
}

export async function createCollectionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const name = ((formData.get('name') as string | null) || '').trim();
  const description = ((formData.get('description') as string | null) || '').trim() || null;
  const selectedFileIds = readSelectedFileIds(formData);

  if (!name) {
    redirectWithError('/dashboard', '묶음 이름을 입력해주세요.');
  }

  if (selectedFileIds.length < 2) {
    redirectWithError('/dashboard', '문서 묶음에는 최소 2개 파일을 선택해주세요.');
  }

  const { data: ownedFiles, error: filesError } = await admin
    .from('files')
    .select('id')
    .in('id', selectedFileIds)
    .eq('owner_id', user.id);

  if (filesError || (ownedFiles?.length ?? 0) !== selectedFileIds.length) {
    redirectWithError('/dashboard', '선택한 파일 중 접근할 수 없는 항목이 있습니다.');
  }

  const { data: createdCollection, error: createError } = await admin
    .from('collections')
    .insert({
      owner_id: user.id,
      name,
      description
    })
    .select('id')
    .maybeSingle();

  if (createError || !createdCollection) {
    redirectWithError('/dashboard', '문서 묶음을 생성하지 못했습니다.');
  }

  const mappingRows = selectedFileIds.map((fileId, index) => ({
    collection_id: createdCollection.id,
    file_id: fileId,
    owner_id: user.id,
    sort_order: index
  }));

  const { error: mappingError } = await admin.from('collection_files').insert(mappingRows);
  if (mappingError) {
    await admin.from('collections').delete().eq('id', createdCollection.id).eq('owner_id', user.id);
    redirectWithError('/dashboard', '문서 묶음 파일 연결에 실패했습니다.');
  }

  revalidatePath('/dashboard');
  redirectWithSuccess(`/dashboard/collections/${createdCollection.id}`, '문서 묶음이 생성되었습니다.');
}

export async function deleteCollectionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  if (!collectionId) {
    redirectWithError('/dashboard', '삭제할 문서 묶음을 확인할 수 없습니다.');
  }

  const { error } = await admin.from('collections').delete().eq('id', collectionId).eq('owner_id', user.id);
  if (error) {
    redirectWithError('/dashboard', '문서 묶음 삭제에 실패했습니다.');
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/trash');
  redirectWithSuccess('/dashboard', '문서 묶음을 삭제했습니다.');
}

export async function createMcpApiKeyAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const label = ((formData.get('label') as string | null) || '').trim();
  if (!label) {
    redirectWithError('/dashboard/automations', 'API 키 이름을 입력해주세요.');
  }

  const selectedScopes = normalizeMcpScopes(
    formData
      .getAll('scopes')
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => Boolean(value))
  );

  const scopes = selectedScopes.length > 0 ? selectedScopes : MCP_DEFAULT_SCOPES;
  const rawKey = generateMcpApiKey();

  const { error } = await admin.from('mcp_api_keys').insert({
    owner_id: user.id,
    label,
    key_hash: hashMcpApiKey(rawKey),
    key_prefix: getMcpKeyPrefix(rawKey),
    scopes
  });

  if (error) {
    redirectWithError('/dashboard/automations', 'API 키 생성에 실패했습니다.');
  }

  revalidatePath('/dashboard/automations');
  const url = new URL('/dashboard/automations', 'http://localhost');
  url.searchParams.set('success', 'MCP API 키가 생성되었습니다. 지금 값은 다시 확인할 수 없으니 복사해주세요.');
  url.searchParams.set('newKey', rawKey);
  redirect(`${url.pathname}${url.search}`);
}

export async function revokeMcpApiKeyAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const keyId = ((formData.get('keyId') as string | null) || '').trim();
  if (!keyId) {
    redirectWithError('/dashboard/automations', '비활성화할 API 키를 찾을 수 없습니다.');
  }

  const { error } = await admin
    .from('mcp_api_keys')
    .update({
      revoked_at: new Date().toISOString()
    })
    .eq('id', keyId)
    .eq('owner_id', user.id)
    .is('revoked_at', null);

  if (error) {
    redirectWithError('/dashboard/automations', 'API 키 비활성화에 실패했습니다.');
  }

  revalidatePath('/dashboard/automations');
  redirectWithSuccess('/dashboard/automations', 'API 키를 비활성화했습니다.');
}

export async function createAutomationSubscriptionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const name = ((formData.get('name') as string | null) || '').trim();
  const webhookUrl = ((formData.get('webhookUrl') as string | null) || '').trim();
  const signingSecret = ((formData.get('signingSecret') as string | null) || '').trim() || null;
  const eventTypes = readEventTypes(formData);
  const isActive = parseBoolean(formData, 'isActive');

  if (!name || !webhookUrl) {
    redirectWithError('/dashboard/automations', '구독 이름과 웹훅 URL은 필수입니다.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    redirectWithError('/dashboard/automations', '유효한 웹훅 URL을 입력해주세요.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    redirectWithError('/dashboard/automations', '웹훅 URL은 http/https만 지원합니다.');
  }

  const { error } = await admin.from('automation_subscriptions').insert({
    owner_id: user.id,
    name,
    webhook_url: parsedUrl.toString(),
    signing_secret: signingSecret,
    event_types: eventTypes,
    is_active: isActive
  });

  if (error) {
    redirectWithError('/dashboard/automations', '이벤트 구독 생성에 실패했습니다.');
  }

  revalidatePath('/dashboard/automations');
  redirectWithSuccess('/dashboard/automations', '이벤트 구독이 생성되었습니다.');
}

export async function toggleAutomationSubscriptionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const subscriptionId = ((formData.get('subscriptionId') as string | null) || '').trim();
  const nextValue = parseBoolean(formData, 'nextValue');

  if (!subscriptionId) {
    redirectWithError('/dashboard/automations', '상태를 변경할 구독을 찾을 수 없습니다.');
  }

  const { error } = await admin
    .from('automation_subscriptions')
    .update({
      is_active: nextValue
    })
    .eq('id', subscriptionId)
    .eq('owner_id', user.id);

  if (error) {
    redirectWithError('/dashboard/automations', '구독 상태 변경에 실패했습니다.');
  }

  revalidatePath('/dashboard/automations');
  redirectWithSuccess('/dashboard/automations', '구독 상태를 업데이트했습니다.');
}

export async function deleteAutomationSubscriptionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const subscriptionId = ((formData.get('subscriptionId') as string | null) || '').trim();
  if (!subscriptionId) {
    redirectWithError('/dashboard/automations', '삭제할 구독을 찾을 수 없습니다.');
  }

  const { error } = await admin
    .from('automation_subscriptions')
    .delete()
    .eq('id', subscriptionId)
    .eq('owner_id', user.id);

  if (error) {
    redirectWithError('/dashboard/automations', '구독 삭제에 실패했습니다.');
  }

  revalidatePath('/dashboard/automations');
  redirectWithSuccess('/dashboard/automations', '구독을 삭제했습니다.');
}

export async function createShareLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const fileId = (formData.get('fileId') as string | null)?.trim();
  if (!fileId) {
    redirectWithError('/dashboard', '파일 정보가 누락되었습니다.');
  }

  const { data: ownedFile } = await admin
    .from('files')
    .select('id')
    .eq('id', fileId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!ownedFile) {
    redirectWithError('/dashboard', '파일 권한이 없습니다.');
  }

  const label = ((formData.get('label') as string | null) || '').trim();
  if (!label) {
    redirectWithError(`/dashboard/files/${fileId}`, '링크 이름은 필수입니다.');
  }

  const allowedDomains = parseAllowedDomains(((formData.get('allowedDomains') as string | null) || '').trim());
  const requireEmail = parseBoolean(formData, 'requireEmail') || allowedDomains.length > 0;
  const rawPassword = ((formData.get('password') as string | null) || '').trim();
  const passwordHash = rawPassword ? await hashPassword(rawPassword) : null;

  const { error } = await admin.from('share_links').insert({
    file_id: fileId,
    collection_id: null,
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
    redirectWithError(`/dashboard/files/${fileId}`, '링크 생성에 실패했습니다.');
  }

  revalidatePath(`/dashboard/files/${fileId}`);
  redirectWithSuccess(`/dashboard/files/${fileId}`, '공유 링크가 생성되었습니다.');
}

export async function createCollectionShareLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  if (!collectionId) {
    redirectWithError('/dashboard', '문서 묶음 정보가 누락되었습니다.');
  }

  const { data: ownedCollection } = await admin
    .from('collections')
    .select('id')
    .eq('id', collectionId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!ownedCollection) {
    redirectWithError('/dashboard', '문서 묶음 권한이 없습니다.');
  }

  const label = ((formData.get('label') as string | null) || '').trim();
  if (!label) {
    redirectWithError(`/dashboard/collections/${collectionId}`, '링크 이름은 필수입니다.');
  }

  const allowedDomains = parseAllowedDomains(((formData.get('allowedDomains') as string | null) || '').trim());
  const requireEmail = parseBoolean(formData, 'requireEmail') || allowedDomains.length > 0;
  const rawPassword = ((formData.get('password') as string | null) || '').trim();
  const passwordHash = rawPassword ? await hashPassword(rawPassword) : null;

  const { error } = await admin.from('share_links').insert({
    file_id: null,
    collection_id: collectionId,
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
    redirectWithError(`/dashboard/collections/${collectionId}`, '링크 생성에 실패했습니다.');
  }

  revalidatePath(`/dashboard/collections/${collectionId}`);
  redirectWithSuccess(`/dashboard/collections/${collectionId}`, '문서 묶음 링크가 생성되었습니다.');
}

export async function updateShareLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const linkId = ((formData.get('linkId') as string | null) || '').trim();

  if (!linkId) {
    redirectWithError('/dashboard', '링크 수정에 필요한 정보가 누락되었습니다.');
  }

  const { data: existingLink, error: fetchError } = await admin
    .from('share_links')
    .select('id, file_id, collection_id, password_hash')
    .eq('id', linkId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (fetchError || !existingLink) {
    redirectWithError('/dashboard', '링크를 찾을 수 없습니다.');
  }

  const redirectPath = readSafeRedirectPath(formData, getLinkOwnerPath(existingLink));

  const label = ((formData.get('label') as string | null) || '').trim();
  if (!label) {
    redirectWithError(redirectPath, '링크 이름은 필수입니다.');
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
    redirectWithError(redirectPath, '링크 수정에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  revalidatePath(`/dashboard/links/${linkId}`);
  redirectWithSuccess(redirectPath, '링크 정책이 업데이트되었습니다.');
}

export async function softDeleteLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const linkId = ((formData.get('linkId') as string | null) || '').trim();

  if (!linkId) {
    redirectWithError('/dashboard', '삭제할 링크를 확인할 수 없습니다.');
  }

  const { data: existingLink, error: existingError } = await admin
    .from('share_links')
    .select('id, file_id, collection_id')
    .eq('id', linkId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (existingError || !existingLink) {
    redirectWithError('/dashboard', '삭제할 링크를 찾을 수 없습니다.');
  }

  const redirectPath = readSafeRedirectPath(formData, getLinkOwnerPath(existingLink));

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
    redirectWithError(redirectPath, '링크 삭제에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  revalidatePath('/dashboard/trash');
  redirectWithSuccess(redirectPath, '링크가 휴지통으로 이동했습니다.');
}

export async function restoreLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const linkId = ((formData.get('linkId') as string | null) || '').trim();

  if (!linkId) {
    redirectWithError('/dashboard/trash', '복구할 링크를 확인할 수 없습니다.');
  }

  const { data: link, error: fetchError } = await admin
    .from('share_links')
    .select('id, file_id, collection_id')
    .eq('id', linkId)
    .eq('owner_id', user.id)
    .not('deleted_at', 'is', null)
    .maybeSingle();

  if (fetchError || !link) {
    redirectWithError('/dashboard/trash', '복구할 링크를 찾을 수 없습니다.');
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
    redirectWithError('/dashboard/trash', '링크 복구에 실패했습니다.');
  }

  const ownerPath = getLinkOwnerPath(link);
  revalidatePath('/dashboard/trash');
  revalidatePath(ownerPath);
  redirectWithSuccess('/dashboard/trash', '링크를 복구했습니다.');
}

export async function hardDeleteLinkAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const linkId = ((formData.get('linkId') as string | null) || '').trim();
  const confirmation = ((formData.get('confirmation') as string | null) || '').trim().toUpperCase();

  if (!linkId) {
    redirectWithError('/dashboard/trash', '삭제할 링크를 확인할 수 없습니다.');
  }

  if (confirmation !== 'DELETE') {
    redirectWithError('/dashboard/trash', '영구 삭제하려면 DELETE를 입력하세요.');
  }

  const { data: link, error: fetchError } = await admin
    .from('share_links')
    .select('id, file_id, collection_id')
    .eq('id', linkId)
    .eq('owner_id', user.id)
    .not('deleted_at', 'is', null)
    .maybeSingle();

  if (fetchError || !link) {
    redirectWithError('/dashboard/trash', '영구 삭제할 링크를 찾을 수 없습니다.');
  }

  const { error } = await admin.from('share_links').delete().eq('id', linkId).eq('owner_id', user.id);

  if (error) {
    redirectWithError('/dashboard/trash', '영구 삭제에 실패했습니다.');
  }

  const ownerPath = getLinkOwnerPath(link);
  revalidatePath('/dashboard/trash');
  revalidatePath(ownerPath);
  redirectWithSuccess('/dashboard/trash', '링크를 영구 삭제했습니다.');
}

export async function deleteFileAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const fileId = ((formData.get('fileId') as string | null) || '').trim();

  if (!fileId) {
    redirectWithError('/dashboard', '파일 정보가 누락되었습니다.');
  }

  const { data: file, error: fileError } = await admin
    .from('files')
    .select('id, storage_path')
    .eq('id', fileId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (fileError || !file) {
    redirectWithError('/dashboard', '파일을 찾을 수 없습니다.');
  }

  await admin.from('files').delete().eq('id', fileId).eq('owner_id', user.id);
  await removePdfObject(file.storage_path);

  revalidatePath('/dashboard');
  redirectWithSuccess('/dashboard', '파일과 연결된 링크를 삭제했습니다.');
}
