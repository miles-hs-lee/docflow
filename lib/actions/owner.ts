'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { MCP_DEFAULT_SCOPES, normalizeMcpScopes } from '@/lib/agent-auth';
import { requireOwner } from '@/lib/auth';
import { removeLogoObject, removePdfObject } from '@/lib/data';
import { MCP_NEW_KEY_COOKIE } from '@/lib/mcp-key-cookie';
import { normalizeBrandColor } from '@/lib/branding';
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

  return ['view', 'denied', 'email_submitted', 'password_failed', 'download', 'agreement'];
}

// Create an EMPTY data room (name + description only). Files and folders are
// added afterward on the room page — no files are required at creation.
export async function createCollectionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const name = ((formData.get('name') as string | null) || '').trim();
  const description = ((formData.get('description') as string | null) || '').trim() || null;

  if (!name) {
    redirectWithError('/dashboard/collections', '데이터룸 이름을 입력해주세요.');
  }

  const { data: createdCollection, error: createError } = await admin
    .from('collections')
    .insert({ owner_id: user.id, name, description })
    .select('id')
    .maybeSingle();

  if (createError || !createdCollection) {
    redirectWithError('/dashboard/collections', '데이터룸을 생성하지 못했습니다.');
  }

  revalidatePath('/dashboard/collections');
  redirectWithSuccess(
    `/dashboard/collections/${createdCollection.id}`,
    '데이터룸을 만들었습니다. 파일을 추가해 구성하세요.'
  );
}

// Add existing library files to a data room. Skips files already in the room
// and appends after the current max sort_order.
export async function addFilesToCollectionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const fileIds = readSelectedFileIds(formData);
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!collectionId) {
    redirectWithError('/dashboard', '데이터룸 정보가 누락되었습니다.');
  }
  if (fileIds.length === 0) {
    redirectWithError(redirectPath, '추가할 파일을 선택해주세요.');
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

  const { data: ownedFiles, error: filesError } = await admin
    .from('files')
    .select('id')
    .in('id', fileIds)
    .eq('owner_id', user.id);
  if (filesError || (ownedFiles?.length ?? 0) !== fileIds.length) {
    redirectWithError(redirectPath, '선택한 파일 중 접근할 수 없는 항목이 있습니다.');
  }

  const { data: existing } = await admin
    .from('collection_files')
    .select('file_id, sort_order')
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id);
  const existingRows = (existing ?? []) as Array<{ file_id: string; sort_order: number }>;
  const existingIds = new Set(existingRows.map((row) => row.file_id));
  const maxSort = existingRows.reduce((max, row) => Math.max(max, row.sort_order ?? 0), -1);
  const toAdd = fileIds.filter((id) => !existingIds.has(id));

  if (toAdd.length > 0) {
    const rows = toAdd.map((fileId, index) => ({
      collection_id: collectionId,
      file_id: fileId,
      owner_id: user.id,
      sort_order: maxSort + 1 + index
    }));
    const { error: insertError } = await admin.from('collection_files').insert(rows);
    if (insertError) {
      redirectWithError(redirectPath, '파일 추가에 실패했습니다.');
    }
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(
    redirectPath,
    toAdd.length > 0 ? `파일 ${toAdd.length}개를 추가했습니다.` : '이미 데이터룸에 포함된 파일입니다.'
  );
}

// Remove a file from a data room (unlink only — the file stays in the library
// and any other rooms). Actual file deletion lives on the content page.
export async function removeFileFromCollectionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const fileId = ((formData.get('fileId') as string | null) || '').trim();
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!collectionId || !fileId) {
    redirectWithError('/dashboard', '정보가 누락되었습니다.');
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

  const { error } = await admin
    .from('collection_files')
    .delete()
    .eq('collection_id', collectionId)
    .eq('file_id', fileId)
    .eq('owner_id', user.id);
  if (error) {
    redirectWithError(redirectPath, '파일 제거에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '데이터룸에서 파일을 제거했습니다.');
}

// Persist a new file order WITHIN one container of a data room (the root, or a
// single folder). Renumbers collection_files.sort_order to 0..n-1 in the posted
// order. Because the owner editor + viewer both render files grouped by folder,
// numbering each container independently is enough — within-container order is
// all that's observable, and 0..n-1 guarantees it's unambiguous. Called
// programmatically from the structure editor (optimistic drag-and-drop), so it
// never redirects: it revalidates and returns, and the client refreshes.
export async function reorderCollectionFilesAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const folderRaw = ((formData.get('folderId') as string | null) || 'root').trim();
  // '' or 'root' → the space root (folder_id NULL).
  const folderId = folderRaw === '' || folderRaw === 'root' ? null : folderRaw;
  const orderedIds = readSelectedFileIds(formData);

  if (!collectionId || orderedIds.length === 0) return;

  // Ownership: the collection must belong to the caller.
  const { data: owned } = await admin
    .from('collections')
    .select('id')
    .eq('id', collectionId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!owned) return;

  // Current members of this exact container, scoped to owner + collection +
  // folder. Reordering only ever touches rows that already live here.
  let membersQuery = admin
    .from('collection_files')
    .select('file_id')
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id);
  membersQuery = folderId === null ? membersQuery.is('folder_id', null) : membersQuery.eq('folder_id', folderId);
  const { data: members } = await membersQuery;
  const memberIds = new Set(((members ?? []) as Array<{ file_id: string }>).map((row) => row.file_id));
  if (memberIds.size === 0) return;

  // Posted order filtered to real members (stale/tamper guard), then any member
  // the client omitted appended after — so the whole container is renumbered
  // with no gaps or duplicate sort_order values.
  const present = orderedIds.filter((id) => memberIds.has(id));
  const presentSet = new Set(present);
  const finalOrder = [...present, ...[...memberIds].filter((id) => !presentSet.has(id))];

  await Promise.all(
    finalOrder.map((fileId, index) =>
      admin
        .from('collection_files')
        .update({ sort_order: index })
        .eq('collection_id', collectionId)
        .eq('file_id', fileId)
        .eq('owner_id', user.id)
    )
  );

  revalidatePath(`/dashboard/collections/${collectionId}`);
}

export async function deleteCollectionAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  if (!collectionId) {
    redirectWithError('/dashboard/collections', '삭제할 데이터룸을 확인할 수 없습니다.');
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
    redirectWithError('/dashboard/collections', '데이터룸 삭제에 실패했습니다.');
  }
  if (status === 'not_found') {
    redirectWithError('/dashboard/collections', '삭제할 데이터룸을 확인할 수 없습니다.');
  }
  if (status === 'active_links_exist') {
    redirectWithError(
      '/dashboard',
      '활성 링크가 남아있어 데이터룸을 삭제할 수 없습니다. 휴지통에서 먼저 정리하세요.'
    );
  }

  revalidatePath('/dashboard/collections');
  revalidatePath('/dashboard/trash');
  redirectWithSuccess('/dashboard/collections', '데이터룸을 삭제했습니다.');
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
  // Phase 3: optionally scope this link to a viewer group (must belong to the
  // same data room + owner). 'all'/empty = full access; an invalid id errors.
  const viewerGroupId = await resolveViewerGroupId(
    admin,
    formData,
    collectionId,
    user.id,
    `/dashboard/collections/${collectionId}`
  );

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
    agreement_text: agreementText,
    viewer_group_id: viewerGroupId
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
  // Phase 3: only collection links carry a viewer group; file links stay null.
  // The collection-link edit form always submits the current group so this is a
  // no-op unless the owner actually changed it (changing it bumps policy_version).
  const viewerGroupId = existingLink.collection_id
    ? await resolveViewerGroupId(admin, formData, existingLink.collection_id, user.id, redirectPath)
    : null;

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
      agreement_text: agreementText,
      viewer_group_id: viewerGroupId
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
      '/dashboard/files',
      '활성 링크가 남아있어 파일을 삭제할 수 없습니다. 휴지통에서 먼저 정리하세요.'
    );
  }
  if (status === 'active_collection_links_exist') {
    redirectWithError(
      '/dashboard/files',
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

  revalidatePath('/dashboard/files');
  redirectWithSuccess('/dashboard/files', '파일과 연결된 링크를 삭제했습니다.');
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

  // Scope by collection_id too so a forged/stale collectionId can't rename a
  // folder that lives in a different data room (it just no-ops instead).
  const { error } = await admin
    .from('folders')
    .update({ name: name.slice(0, 120) })
    .eq('id', folderId)
    .eq('collection_id', collectionId)
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
  // Scope by collection_id so a forged/stale collectionId can't delete a
  // folder belonging to a different data room.
  const { error } = await admin
    .from('folders')
    .delete()
    .eq('id', folderId)
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id);
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

// ───────────────────────────────────────────────────────────
// Data room Phase 3: viewer groups + per-folder permissions.

// Resolve a posted viewerGroupId to a validated group id (or null for full
// access). 'all'/empty → null. A non-empty id must name a group in the same
// data room owned by the caller, else it falls back to null (never widens to a
// foreign group).
async function resolveViewerGroupId(
  admin: ReturnType<typeof createAdminClient>,
  formData: FormData,
  collectionId: string | null,
  ownerId: string,
  redirectPath: string
): Promise<string | null> {
  const raw = ((formData.get('viewerGroupId') as string | null) || '').trim();
  if (!raw || raw === 'all' || !collectionId) return null;
  const { data } = await admin
    .from('viewer_groups')
    .select('id')
    .eq('id', raw)
    .eq('collection_id', collectionId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  // A non-empty, non-'all' group id that doesn't resolve to one of THIS
  // collection's groups is rejected — never silently coerced to null, which
  // would widen a restricted link to full access (stale form / tampered post).
  if (!data) {
    redirectWithError(redirectPath, '유효하지 않은 뷰어 그룹입니다.');
  }
  return raw;
}

export async function createViewerGroupAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const name = ((formData.get('name') as string | null) || '').trim();
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!collectionId) {
    redirectWithError('/dashboard', '데이터룸 정보가 누락되었습니다.');
  }
  if (!name) {
    redirectWithError(redirectPath, '그룹 이름을 입력해주세요.');
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

  const { error } = await admin.from('viewer_groups').insert({
    collection_id: collectionId,
    owner_id: user.id,
    name: name.slice(0, 120)
  });
  if (error) {
    redirectWithError(redirectPath, '그룹 생성에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '뷰어 그룹을 만들었습니다.');
}

export async function renameViewerGroupAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const groupId = ((formData.get('groupId') as string | null) || '').trim();
  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const name = ((formData.get('name') as string | null) || '').trim();
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!groupId || !collectionId) {
    redirectWithError('/dashboard', '그룹 정보가 누락되었습니다.');
  }
  if (!name) {
    redirectWithError(redirectPath, '그룹 이름을 입력해주세요.');
  }

  const { error } = await admin
    .from('viewer_groups')
    .update({ name: name.slice(0, 120) })
    .eq('id', groupId)
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id);
  if (error) {
    redirectWithError(redirectPath, '그룹 이름 변경에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '그룹 이름을 변경했습니다.');
}

export async function deleteViewerGroupAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const groupId = ((formData.get('groupId') as string | null) || '').trim();
  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!groupId || !collectionId) {
    redirectWithError('/dashboard', '그룹 정보가 누락되었습니다.');
  }

  // viewer_group_folders cascade; links assigned to this group revert to full
  // access (share_links.viewer_group_id ON DELETE SET NULL).
  const { error } = await admin
    .from('viewer_groups')
    .delete()
    .eq('id', groupId)
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id);
  if (error) {
    redirectWithError(redirectPath, '그룹 삭제에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '그룹을 삭제했습니다. 연결된 링크는 전체 접근으로 돌아갑니다.');
}

// Reconcile a group's folder grants + include_root in one submit. The form posts
// every checked folder as `folderIds`; unchecked boxes don't post, so the delete-
// then-insert reconcile naturally drops them. Each folder must belong to the same
// data room + owner.
export async function setViewerGroupFoldersAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const groupId = ((formData.get('groupId') as string | null) || '').trim();
  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const includeRoot = parseBoolean(formData, 'includeRoot');
  const redirectPath = `/dashboard/collections/${collectionId}`;

  if (!groupId || !collectionId) {
    redirectWithError('/dashboard', '그룹 정보가 누락되었습니다.');
  }

  const { data: group } = await admin
    .from('viewer_groups')
    .select('id')
    .eq('id', groupId)
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!group) {
    redirectWithError(redirectPath, '그룹을 찾을 수 없습니다.');
  }

  const requested = formData
    .getAll('folderIds')
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);

  // Keep only folders that actually belong to this data room + owner.
  let validIds: string[] = [];
  if (requested.length > 0) {
    const { data: folderRows } = await admin
      .from('folders')
      .select('id')
      .eq('collection_id', collectionId)
      .eq('owner_id', user.id)
      .in('id', requested);
    validIds = ((folderRows ?? []) as Array<{ id: string }>).map((row) => row.id);
  }

  // Reconcile: drop all current grants for the group, then insert the new set.
  await admin.from('viewer_group_folders').delete().eq('group_id', groupId).eq('owner_id', user.id);

  if (validIds.length > 0) {
    const { error: insertError } = await admin
      .from('viewer_group_folders')
      .insert(validIds.map((folderId) => ({ group_id: groupId, folder_id: folderId, owner_id: user.id })));
    if (insertError) {
      redirectWithError(redirectPath, '폴더 권한 저장에 실패했습니다.');
    }
  }

  const { error: updateError } = await admin
    .from('viewer_groups')
    .update({ include_root: includeRoot })
    .eq('id', groupId)
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id);
  if (updateError) {
    redirectWithError(redirectPath, '폴더 권한 저장에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '폴더 권한을 저장했습니다.');
}

// ───────────────────────────────────────────────────────────
// File Request (inbound upload).

export async function createFileRequestAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const title = ((formData.get('title') as string | null) || '').trim();
  if (!title) {
    redirectWithError('/dashboard/requests', '요청 제목을 입력해주세요.');
  }
  const instructions = ((formData.get('instructions') as string | null) || '').trim().slice(0, 2000) || null;

  // Empty = unlimited. A provided value must be a positive integer — reject 0 /
  // negatives / non-numerics instead of silently coercing them to "unlimited".
  const rawMaxUploads = ((formData.get('maxUploads') as string | null) || '').trim();
  if (rawMaxUploads && (!/^\d+$/.test(rawMaxUploads) || Number.parseInt(rawMaxUploads, 10) < 1)) {
    redirectWithError('/dashboard/requests', '최대 업로드 수는 1 이상의 숫자여야 합니다.');
  }
  const maxUploads = rawMaxUploads ? Number.parseInt(rawMaxUploads, 10) : null;

  const { error } = await admin.from('file_requests').insert({
    owner_id: user.id,
    token: generateShareToken(),
    title: title.slice(0, 200),
    instructions,
    require_email: parseBoolean(formData, 'requireEmail'),
    is_active: parseBoolean(formData, 'isActive'),
    expires_at: parseOptionalDate(formData, 'expiresAt'),
    max_uploads: maxUploads
  });
  if (error) {
    redirectWithError('/dashboard/requests', '파일 요청 생성에 실패했습니다.');
  }

  revalidatePath('/dashboard/requests');
  redirectWithSuccess('/dashboard/requests', '파일 요청을 만들었습니다.');
}

export async function toggleFileRequestAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const requestId = ((formData.get('requestId') as string | null) || '').trim();
  if (!requestId) {
    redirectWithError('/dashboard/requests', '요청 정보가 누락되었습니다.');
  }

  const { data: existing } = await admin
    .from('file_requests')
    .select('is_active')
    .eq('id', requestId)
    .eq('owner_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!existing) {
    redirectWithError('/dashboard/requests', '요청을 찾을 수 없습니다.');
  }

  const wasActive = (existing as { is_active: boolean }).is_active;
  const { error } = await admin
    .from('file_requests')
    .update({ is_active: !wasActive })
    .eq('id', requestId)
    .eq('owner_id', user.id);
  if (error) {
    redirectWithError('/dashboard/requests', '상태 변경에 실패했습니다.');
  }

  revalidatePath('/dashboard/requests');
  redirectWithSuccess('/dashboard/requests', wasActive ? '요청을 비활성화했습니다.' : '요청을 활성화했습니다.');
}

export async function deleteFileRequestAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const requestId = ((formData.get('requestId') as string | null) || '').trim();
  if (!requestId) {
    redirectWithError('/dashboard/requests', '요청 정보가 누락되었습니다.');
  }

  // Soft-delete: hide from the owner list + reject further uploads. Uploaded
  // objects linger in storage (mirrors share-link soft-delete).
  const { error } = await admin
    .from('file_requests')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', requestId)
    .eq('owner_id', user.id);
  if (error) {
    redirectWithError('/dashboard/requests', '요청 삭제에 실패했습니다.');
  }

  revalidatePath('/dashboard/requests');
  redirectWithSuccess('/dashboard/requests', '파일 요청을 삭제했습니다.');
}

// ───────────────────────────────────────────────────────────
// Custom branding (white-label). Logo upload is a separate multipart route
// (app/dashboard/logo); these handle the text fields + logo removal.

export async function saveBrandingAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const companyName = ((formData.get('companyName') as string | null) || '').trim().slice(0, 80) || null;

  const { color: brandColor, invalid: colorInvalid } = normalizeBrandColor(
    (formData.get('brandColor') as string | null) || ''
  );
  if (colorInvalid) {
    redirectWithError('/dashboard/settings', '브랜드 색상은 #RRGGBB 형식이어야 합니다. (예: #1a73e8)');
  }

  // Upsert only the text fields → an existing logo_path is preserved.
  const { error } = await admin
    .from('owner_branding')
    .upsert({ owner_id: user.id, company_name: companyName, brand_color: brandColor }, { onConflict: 'owner_id' });
  if (error) {
    redirectWithError('/dashboard/settings', '브랜딩 저장에 실패했습니다.');
  }

  revalidatePath('/dashboard/settings');
  redirectWithSuccess('/dashboard/settings', '브랜딩을 저장했습니다.');
}

export async function removeBrandingLogoAction() {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const { data } = await admin
    .from('owner_branding')
    .select('logo_path')
    .eq('owner_id', user.id)
    .maybeSingle();
  const logoPath = (data as { logo_path: string | null } | null)?.logo_path ?? null;

  // Clear the DB reference FIRST and only delete the object if that succeeded —
  // otherwise a failed update would leave logo_path pointing at a deleted file
  // (a broken logo on the viewer pages).
  const { error: updateError } = await admin
    .from('owner_branding')
    .update({ logo_path: null })
    .eq('owner_id', user.id);
  if (updateError) {
    redirectWithError('/dashboard/settings', '로고 제거에 실패했습니다.');
  }
  if (logoPath) {
    try {
      await removeLogoObject(logoPath);
    } catch {
      // best-effort — an orphaned logo object is cosmetic
    }
  }

  revalidatePath('/dashboard/settings');
  redirectWithSuccess('/dashboard/settings', '로고를 제거했습니다.');
}

export async function removeBrandingCoverAction() {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const { data } = await admin
    .from('owner_branding')
    .select('cover_image_path')
    .eq('owner_id', user.id)
    .maybeSingle();
  const coverPath = (data as { cover_image_path: string | null } | null)?.cover_image_path ?? null;

  // Clear the DB reference FIRST, then delete the object — never leave
  // cover_image_path pointing at a removed file (a broken cover on the pages).
  const { error: updateError } = await admin
    .from('owner_branding')
    .update({ cover_image_path: null })
    .eq('owner_id', user.id);
  if (updateError) {
    redirectWithError('/dashboard/settings', '커버 이미지 제거에 실패했습니다.');
  }
  if (coverPath) {
    try {
      await removeLogoObject(coverPath);
    } catch {
      // best-effort — an orphaned cover object is cosmetic
    }
  }

  revalidatePath('/dashboard/settings');
  redirectWithSuccess('/dashboard/settings', '커버 이미지를 제거했습니다.');
}

// ───────────────────────────────────────────────────────────
// Per-data-room branding (mirrors account branding, scoped to a collection).

export async function saveCollectionBrandingAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const redirectPath = `/dashboard/collections/${collectionId}`;
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

  const companyName = ((formData.get('companyName') as string | null) || '').trim().slice(0, 80) || null;

  const { color: brandColor, invalid: colorInvalid } = normalizeBrandColor(
    (formData.get('brandColor') as string | null) || ''
  );
  if (colorInvalid) {
    redirectWithError(redirectPath, '브랜드 색상은 #RRGGBB 형식이어야 합니다. (예: #1a73e8)');
  }

  // Upsert only the text fields → an existing logo_path is preserved.
  const { error } = await admin.from('collection_branding').upsert(
    { collection_id: collectionId, owner_id: user.id, company_name: companyName, brand_color: brandColor },
    { onConflict: 'collection_id' }
  );
  if (error) {
    redirectWithError(redirectPath, '브랜딩 저장에 실패했습니다.');
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '데이터룸 브랜딩을 저장했습니다.');
}

export async function removeCollectionBrandingLogoAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const redirectPath = `/dashboard/collections/${collectionId}`;
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

  const { data } = await admin
    .from('collection_branding')
    .select('logo_path')
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id)
    .maybeSingle();
  const logoPath = (data as { logo_path: string | null } | null)?.logo_path ?? null;

  const { error: updateError } = await admin
    .from('collection_branding')
    .update({ logo_path: null })
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id);
  if (updateError) {
    redirectWithError(redirectPath, '로고 제거에 실패했습니다.');
  }
  if (logoPath) {
    try {
      await removeLogoObject(logoPath);
    } catch {
      // best-effort
    }
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '데이터룸 로고를 제거했습니다.');
}

export async function removeCollectionBrandingCoverAction(formData: FormData) {
  const { user } = await requireOwner();
  const admin = createAdminClient();

  const collectionId = ((formData.get('collectionId') as string | null) || '').trim();
  const redirectPath = `/dashboard/collections/${collectionId}`;
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

  const { data } = await admin
    .from('collection_branding')
    .select('cover_image_path')
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id)
    .maybeSingle();
  const coverPath = (data as { cover_image_path: string | null } | null)?.cover_image_path ?? null;

  const { error: updateError } = await admin
    .from('collection_branding')
    .update({ cover_image_path: null })
    .eq('collection_id', collectionId)
    .eq('owner_id', user.id);
  if (updateError) {
    redirectWithError(redirectPath, '커버 이미지 제거에 실패했습니다.');
  }
  if (coverPath) {
    try {
      await removeLogoObject(coverPath);
    } catch {
      // best-effort
    }
  }

  revalidatePath(redirectPath);
  redirectWithSuccess(redirectPath, '데이터룸 커버 이미지를 제거했습니다.');
}
