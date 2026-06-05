'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { MCP_DEFAULT_SCOPES, normalizeMcpScopes } from '@/lib/agent-auth';
import { requireOwner } from '@/lib/auth';
import { removePdfObject } from '@/lib/data';
import { MCP_NEW_KEY_COOKIE } from '@/lib/mcp-key-cookie';
import { assertSafePublicUrl } from '@/lib/url-safety';
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
    redirectWithError('/dashboard', '데이터룸 이름을 입력해주세요.');
  }

  if (selectedFileIds.length < 2) {
    redirectWithError('/dashboard', '데이터룸에는 최소 2개 파일을 선택해주세요.');
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
    redirectWithError('/dashboard', '데이터룸을 생성하지 못했습니다.');
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
    redirectWithError('/dashboard', '데이터룸 파일 연결에 실패했습니다.');
  }

  revalidatePath('/dashboard');
  redirectWithSuccess(`/dashboard/collections/${createdCollection.id}`, '데이터룸이 생성되었습니다.');
}

export async function deleteCollectionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  if (!collectionId) {
    redirectWithError('/dashboard', '삭제할 데이터룸을 확인할 수 없습니다.');
  }

  // delete_collection_cascade (migration 009) wraps the active-link gate,
  // trash-link cleanup, event cleanup, and collection row delete inside a
  // single PL/pgSQL transaction. Returns 'not_found' / 'active_links_exist' / 'ok'.
  const { data, error: rpcError } = await admin.rpc('delete_collection_cascade', {
    p_collection_id: collectionId,
    p_owner_id: user.id
  });

  const status = Array.isArray(data) ? data[0]?.status : null;
  if (rpcError || status == null) {
    redirectWithError('/dashboard', '데이터룸 삭제에 실패했습니다.');
  }
  if (status === 'not_found') {
    redirectWithError('/dashboard', '삭제할 데이터룸을 확인할 수 없습니다.');
  }
  if (status === 'active_links_exist') {
    redirectWithError(
      '/dashboard',
      '활성 링크가 남아있어 데이터룸을 삭제할 수 없습니다. 휴지통에서 먼저 정리하세요.'
    );
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/trash');
  redirectWithSuccess('/dashboard', '데이터룸을 삭제했습니다.');
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

  // Pass the secret via short-lived HttpOnly cookie instead of URL params,
  // so it never enters Vercel access logs, browser history, or Referer headers.
  const cookieStore = await cookies();
  cookieStore.set(MCP_NEW_KEY_COOKIE, rawKey, {
    path: '/dashboard/automations',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 120 // ~2 minutes — enough to copy, then auto-expires
  });

  revalidatePath('/dashboard/automations');
  redirectWithSuccess(
    '/dashboard/automations',
    'MCP API 키가 생성되었습니다. 지금 값은 다시 확인할 수 없으니 복사해주세요.'
  );
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
  const destinationType =
    ((formData.get('destinationType') as string | null) || '').trim() === 'teams' ? 'teams' : 'webhook';

  if (!name || !webhookUrl) {
    redirectWithError('/dashboard/automations', '구독 이름과 웹훅 URL은 필수입니다.');
  }

  // Refuse to create a subscription when no automation cron secret is set —
  // otherwise outbox rows accumulate but never dispatch (the cron worker
  // refuses to run without the secret), and an owner has no signal that
  // their subscription is silently broken.
  if (!process.env.AUTOMATION_CRON_SECRET && !process.env.CRON_SECRET) {
    redirectWithError(
      '/dashboard/automations',
      '자동화 디스패처가 비활성화되어 있어 구독을 만들 수 없습니다. 관리자에게 AUTOMATION_CRON_SECRET 설정을 요청하세요.'
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = await assertSafePublicUrl(webhookUrl);
  } catch (e) {
    redirectWithError('/dashboard/automations', e instanceof Error ? e.message : '유효한 웹훅 URL을 입력해주세요.');
  }

  const { error } = await admin.from('automation_subscriptions').insert({
    owner_id: user.id,
    name,
    webhook_url: parsedUrl.toString(),
    signing_secret: signingSecret,
    event_types: eventTypes,
    destination_type: destinationType,
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
  const requireAgreement = parseBoolean(formData, 'requireAgreement');
  const agreementText = ((formData.get('agreementText') as string | null) || '').trim().slice(0, 5000) || null;

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
    one_time: parseBoolean(formData, 'oneTime'),
    watermark: parseBoolean(formData, 'watermark'),
    require_agreement: requireAgreement,
    agreement_text: agreementText
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
    redirectWithError('/dashboard', '데이터룸 정보가 누락되었습니다.');
  }

  const { data: ownedCollection } = await admin
    .from('collections')
    .select('id')
    .eq('id', collectionId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!ownedCollection) {
    redirectWithError('/dashboard', '데이터룸 권한이 없습니다.');
  }

  const label = ((formData.get('label') as string | null) || '').trim();
  if (!label) {
    redirectWithError(`/dashboard/collections/${collectionId}`, '링크 이름은 필수입니다.');
  }

  const allowedDomains = parseAllowedDomains(((formData.get('allowedDomains') as string | null) || '').trim());
  const requireEmail = parseBoolean(formData, 'requireEmail') || allowedDomains.length > 0;
  const rawPassword = ((formData.get('password') as string | null) || '').trim();
  const passwordHash = rawPassword ? await hashPassword(rawPassword) : null;
  const requireAgreement = parseBoolean(formData, 'requireAgreement');
  const agreementText = ((formData.get('agreementText') as string | null) || '').trim().slice(0, 5000) || null;

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
    one_time: parseBoolean(formData, 'oneTime'),
    watermark: parseBoolean(formData, 'watermark'),
    require_agreement: requireAgreement,
    agreement_text: agreementText
  });

  if (error) {
    redirectWithError(`/dashboard/collections/${collectionId}`, '링크 생성에 실패했습니다.');
  }

  revalidatePath(`/dashboard/collections/${collectionId}`);
  redirectWithSuccess(`/dashboard/collections/${collectionId}`, '데이터룸 링크가 생성되었습니다.');
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

  const requireAgreement = parseBoolean(formData, 'requireAgreement');
  const agreementText = ((formData.get('agreementText') as string | null) || '').trim().slice(0, 5000) || null;

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
      one_time: parseBoolean(formData, 'oneTime'),
      watermark: parseBoolean(formData, 'watermark'),
      require_agreement: requireAgreement,
      agreement_text: agreementText
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

  // Atomic: link_events delete + share_links delete inside one PL/pgSQL
  // transaction (migration 008). The previous two-step admin client writes
  // could leave the link surviving without its events if the second write
  // failed.
  const { data: deleted, error: rpcError } = await admin.rpc('hard_delete_link', {
    p_link_id: linkId,
    p_owner_id: user.id
  });

  if (rpcError || deleted !== true) {
    redirectWithError('/dashboard/trash', '영구 삭제에 실패했습니다.');
  }

  const ownerPath = getLinkOwnerPath(link);
  revalidatePath('/dashboard/trash');
  revalidatePath(ownerPath);
  redirectWithSuccess('/dashboard/trash', '링크와 관련 이벤트를 영구 삭제했습니다.');
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

  // Order matters: run the DB cascade FIRST so its active-link gate can
  // reject the deletion before we touch storage. If we deleted the PDF
  // first and then learned an active share_link still pointed at it, the
  // owner would be left with a working link to a missing file.
  // delete_file_cascade (migration 009) wraps the active-link gate,
  // trash-link cleanup, event cleanup, and file row delete inside one
  // PL/pgSQL transaction.
  const { data, error: rpcError } = await admin.rpc('delete_file_cascade', {
    p_file_id: fileId,
    p_owner_id: user.id
  });

  const status = Array.isArray(data) ? data[0]?.status : null;
  if (rpcError || status == null) {
    redirectWithError('/dashboard', '파일 삭제에 실패했습니다.');
  }
  if (status === 'not_found') {
    redirectWithError('/dashboard', '파일을 찾을 수 없습니다.');
  }
  if (status === 'active_links_exist') {
    redirectWithError(
      '/dashboard',
      '활성 링크가 남아있어 파일을 삭제할 수 없습니다. 휴지통에서 먼저 정리하세요.'
    );
  }
  if (status === 'active_collection_links_exist') {
    redirectWithError(
      '/dashboard',
      '이 파일이 포함된 데이터룸에 활성 공유 링크가 있어 삭제할 수 없습니다. 데이터룸 링크를 먼저 휴지통으로 옮긴 뒤 다시 시도하세요.'
    );
  }

  // Best-effort storage cleanup AFTER the DB row is gone. If this throws
  // the file row is already deleted (the owner sees the file disappear
  // from the dashboard) and an orphan blob would remain in storage —
  // worse than a broken share_link from a privacy/audit perspective.
  // Queue the failure to pending_storage_deletions so a sweep job (not
  // yet implemented) can retry, and log it for the operator in the
  // meantime. The owner-facing flow still reports success because the
  // record-of-truth (DB) is already consistent.
  try {
    await removePdfObject(file.storage_path);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_error';
    console.error('[deleteFileAction] storage cleanup failed', {
      storagePath: file.storage_path,
      reason
    });
    try {
      await admin.from('pending_storage_deletions').insert({
        storage_path: file.storage_path,
        reason
      });
    } catch (queueErr) {
      // Queue insert itself failed — the console.error above is the only
      // remaining audit trail. Surface it in logs so the operator can
      // recover the storage_path manually if needed.
      console.error('[deleteFileAction] failed to queue storage cleanup', {
        storagePath: file.storage_path,
        reason,
        queueErr: queueErr instanceof Error ? queueErr.message : 'unknown_error'
      });
    }
  }

  revalidatePath('/dashboard');
  redirectWithSuccess('/dashboard', '파일과 연결된 링크를 삭제했습니다.');
}

// ── Space folders (Phase 1) ───────────────────────────────────────────────

export async function createFolderAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const name = ((formData.get('name') as string | null) || '').trim();
  const parentFolderId = ((formData.get('parentFolderId') as string | null) || '').trim() || null;
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!collectionId) {
    redirectWithError('/dashboard', '데이터룸 정보가 누락되었습니다.');
  }
  if (!name) {
    redirectWithError(redirectPath, '폴더 이름을 입력해주세요.');
  }

  const { data: ownedCollection } = await admin
    .from('collections')
    .select('id')
    .eq('id', collectionId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!ownedCollection) {
    redirectWithError('/dashboard', '데이터룸 권한이 없습니다.');
  }

  // A parent folder (if given) must live in the same space and belong to the owner.
  if (parentFolderId) {
    const { data: parent } = await admin
      .from('folders')
      .select('id')
      .eq('id', parentFolderId)
      .eq('collection_id', collectionId)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (!parent) {
      redirectWithError(redirectPath, '상위 폴더를 찾을 수 없습니다.');
    }
  }

  const { error } = await admin.from('folders').insert({
    collection_id: collectionId,
    parent_folder_id: parentFolderId,
    owner_id: user.id,
    name: name.slice(0, 120)
  });
  if (error) {
    redirectWithError(redirectPath, '폴더 생성에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '폴더를 만들었습니다.');
}

export async function renameFolderAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const folderId = ((formData.get('folderId') as string | null) || '').trim();
  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const name = ((formData.get('name') as string | null) || '').trim();
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!folderId || !collectionId) {
    redirectWithError('/dashboard', '폴더 정보가 누락되었습니다.');
  }
  if (!name) {
    redirectWithError(redirectPath, '폴더 이름을 입력해주세요.');
  }

  const { error } = await admin
    .from('folders')
    .update({ name: name.slice(0, 120) })
    .eq('id', folderId)
    .eq('owner_id', user.id);
  if (error) {
    redirectWithError(redirectPath, '폴더 이름 변경에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '폴더 이름을 변경했습니다.');
}

export async function deleteFolderAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const folderId = ((formData.get('folderId') as string | null) || '').trim();
  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!folderId || !collectionId) {
    redirectWithError('/dashboard', '폴더 정보가 누락되었습니다.');
  }

  // Subfolders cascade (parent_folder_id ON DELETE CASCADE); files in this
  // folder drop to the space root (collection_files.folder_id SET NULL).
  const { error } = await admin.from('folders').delete().eq('id', folderId).eq('owner_id', user.id);
  if (error) {
    redirectWithError(redirectPath, '폴더 삭제에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '폴더를 삭제했습니다. 안의 문서는 최상위로 이동했습니다.');
}

export async function moveFileToFolderAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const fileId = ((formData.get('fileId') as string | null) || '').trim();
  // '' or 'root' → move to the space root (folder_id NULL).
  const rawTarget = ((formData.get('folderId') as string | null) || '').trim();
  const targetFolderId = rawTarget && rawTarget !== 'root' ? rawTarget : null;
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!collectionId || !fileId) {
    redirectWithError('/dashboard', '이동 정보가 누락되었습니다.');
  }

  const { data: membership } = await admin
    .from('collection_files')
    .select('file_id')
    .eq('collection_id', collectionId)
    .eq('file_id', fileId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!membership) {
    redirectWithError(redirectPath, '데이터룸에서 해당 문서를 찾을 수 없습니다.');
  }

  if (targetFolderId) {
    const { data: folder } = await admin
      .from('folders')
      .select('id')
      .eq('id', targetFolderId)
      .eq('collection_id', collectionId)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (!folder) {
      redirectWithError(redirectPath, '대상 폴더를 찾을 수 없습니다.');
    }
  }

  const { error } = await admin
    .from('collection_files')
    .update({ folder_id: targetFolderId })
    .eq('collection_id', collectionId)
    .eq('file_id', fileId)
    .eq('owner_id', user.id);
  if (error) {
    redirectWithError(redirectPath, '문서 이동에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '문서를 이동했습니다.');
}
