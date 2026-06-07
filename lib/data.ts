import { cache } from 'react';

import { OWNER_FEED_EVENT_TYPES } from '@/lib/event-labels';
import { kickWebhookDispatch } from '@/lib/qstash';
import { getRedis, isRedisConfigured } from '@/lib/redis';
import { publicEnv } from '@/lib/env-public';
import { createAdminClient } from '@/lib/supabase/admin';
import type { createClient as createOwnerClient } from '@/lib/supabase/server';
import type {
  AutomationSubscriptionRow,
  CollectionRow,
  CollectionSummaryRow,
  DataRoomQuestionRow,
  DeniedReason,
  DeniedReasonCount,
  FileRequestRow,
  FileRequestUploadRow,
  FileRow,
  FolderRow,
  LinkDailyView,
  LinkEventRow,
  LinkEventType,
  LinkMetrics,
  LinkVisitor,
  McpApiKeyRow,
  OwnerContact,
  OwnerOverview,
  PerPageStat,
  ShareLinkRow,
  ShareLinkTrashRow,
  SpaceFile,
  TopDocument,
  ViewerBranding,
  ViewerGroupRow,
  ViewerGroupWithFolders,
  ViewerLinkBundle,
  ViewerQuestion
} from '@/lib/types';

type OwnerClient = Awaited<ReturnType<typeof createOwnerClient>>;

// Real server-side pagination + search. The dashboard reads ?fp / ?fq /
// ?fs / ?fd from the URL and passes them through; the file picker (used
// by the collection builder) hits /api/owner/files with the same args.
export const FILES_PAGE_SIZE_DEFAULT = 25;
export const FILES_PAGE_SIZE_MAX = 100;

export type FilesSortKey = 'created_at' | 'original_name' | 'size_bytes';
export type FilesSortDir = 'asc' | 'desc';

export type ListFilesOptions = {
  limit?: number;
  offset?: number;
  search?: string;
  sortKey?: FilesSortKey;
  sortDir?: FilesSortDir;
};

export async function listFiles(
  ownerClient: OwnerClient,
  workspaceId: string,
  options: ListFilesOptions = {}
): Promise<{ rows: FileRow[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(options.limit ?? FILES_PAGE_SIZE_DEFAULT, 1), FILES_PAGE_SIZE_MAX);
  const offset = Math.max(options.offset ?? 0, 0);
  const sortKey: FilesSortKey = options.sortKey ?? 'created_at';
  const sortDir: FilesSortDir = options.sortDir ?? (sortKey === 'original_name' ? 'asc' : 'desc');
  const search = (options.search ?? '').trim();

  let query = ownerClient.from('files').select('*', { count: 'exact' }).eq('workspace_id', workspaceId);
  if (search) {
    // ILIKE on original_name. Escape % and _ so user-typed patterns
    // can't accidentally turn into wildcards.
    const escaped = search.replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.ilike('original_name', `%${escaped}%`);
  }
  query = query.order(sortKey, { ascending: sortDir === 'asc' }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: (data ?? []) as FileRow[],
    total: count ?? 0,
    limit,
    offset
  };
}

export async function getFile(ownerClient: OwnerClient, workspaceId: string, fileId: string): Promise<FileRow | null> {
  const { data, error } = await ownerClient
    .from('files')
    .select('*')
    .eq('id', fileId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as FileRow | null) ?? null;
}

export async function listCollections(ownerClient: OwnerClient, workspaceId: string): Promise<CollectionSummaryRow[]> {
  const { data: collections, error } = await ownerClient
    .from('collections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (collections ?? []) as CollectionRow[];
  if (rows.length === 0) return [];

  const collectionIds = rows.map((row) => row.id);
  const { data: links, error: linksError } = await ownerClient
    .from('collection_files')
    .select('collection_id')
    .in('collection_id', collectionIds);
  if (linksError) throw linksError;

  const countMap = new Map<string, number>();
  (links ?? []).forEach((item) => {
    const id = (item as { collection_id: string }).collection_id;
    countMap.set(id, (countMap.get(id) ?? 0) + 1);
  });

  return rows.map((row) => ({
    ...row,
    file_count: countMap.get(row.id) ?? 0
  }));
}

export async function listMcpApiKeys(ownerClient: OwnerClient, workspaceId: string): Promise<McpApiKeyRow[]> {
  const { data, error } = await ownerClient
    .from('mcp_api_keys')
    .select('id, owner_id, label, key_prefix, scopes, last_used_at, revoked_at, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as McpApiKeyRow[];
}

export async function listAutomationSubscriptions(
  ownerClient: OwnerClient,
  workspaceId: string
): Promise<AutomationSubscriptionRow[]> {
  const { data, error } = await ownerClient
    .from('automation_subscriptions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AutomationSubscriptionRow[];
}

export async function listLinkEventsForOwner(ownerClient: OwnerClient, workspaceId: string, options?: {
  linkId?: string;
  afterId?: number;
  limit?: number;
}): Promise<LinkEventRow[]> {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  let query = ownerClient
    .from('link_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('id', { ascending: true })
    .limit(limit);

  if (options?.linkId) {
    query = query.eq('link_id', options.linkId);
  }

  if (typeof options?.afterId === 'number') {
    query = query.gt('id', options.afterId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LinkEventRow[];
}

export async function getCollection(
  ownerClient: OwnerClient,
  workspaceId: string,
  collectionId: string
): Promise<CollectionRow | null> {
  const { data, error } = await ownerClient
    .from('collections')
    .select('*')
    .eq('id', collectionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as CollectionRow | null) ?? null;
}

export async function listFilesForCollection(ownerClient: OwnerClient, collectionId: string): Promise<FileRow[]> {
  const { data: mapping, error: mappingError } = await ownerClient
    .from('collection_files')
    .select('file_id, sort_order')
    .eq('collection_id', collectionId)
    .order('sort_order', { ascending: true });
  if (mappingError) throw mappingError;

  const fileIds = (mapping ?? []).map((item) => (item as { file_id: string }).file_id);
  if (fileIds.length === 0) return [];

  const { data: files, error: filesError } = await ownerClient.from('files').select('*').in('id', fileIds);
  if (filesError) throw filesError;

  const fileMap = new Map<string, FileRow>();
  (files ?? []).forEach((file) => {
    fileMap.set((file as FileRow).id, file as FileRow);
  });

  return fileIds.map((id) => fileMap.get(id)).filter((file): file is FileRow => Boolean(file));
}

// Owner-side space contents for the structure editor: the folder rows plus
// every file with its folder placement (folder_id NULL = root). Uses the
// RLS-scoped owner client.
export async function listSpaceContents(
  ownerClient: OwnerClient,
  collectionId: string
): Promise<{ folders: FolderRow[]; files: SpaceFile[] }> {
  const [foldersResult, mappingResult] = await Promise.all([
    ownerClient.from('folders').select('*').eq('collection_id', collectionId).order('sort_order', { ascending: true }),
    ownerClient
      .from('collection_files')
      .select('file_id, sort_order, folder_id')
      .eq('collection_id', collectionId)
      .order('sort_order', { ascending: true })
  ]);
  if (foldersResult.error) throw foldersResult.error;
  if (mappingResult.error) throw mappingResult.error;

  const folders = (foldersResult.data ?? []) as FolderRow[];
  const mappingRows = (mappingResult.data ?? []) as Array<{ file_id: string; folder_id: string | null }>;
  const fileIds = mappingRows.map((item) => item.file_id);
  if (fileIds.length === 0) return { folders, files: [] };

  const { data: filesData, error: filesError } = await ownerClient.from('files').select('*').in('id', fileIds);
  if (filesError) throw filesError;

  const fileMap = new Map<string, FileRow>();
  (filesData ?? []).forEach((row) => fileMap.set((row as FileRow).id, row as FileRow));

  const files = mappingRows
    .map((item) => {
      const f = fileMap.get(item.file_id);
      return f ? ({ ...f, folder_id: item.folder_id ?? null } as SpaceFile) : null;
    })
    .filter((row): row is SpaceFile => Boolean(row));

  return { folders, files };
}

export async function listLinksForFile(ownerClient: OwnerClient, fileId: string): Promise<ShareLinkRow[]> {
  const { data, error } = await ownerClient
    .from('share_links')
    .select('*')
    .eq('file_id', fileId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as ShareLinkRow[];
}

export async function listLinksForCollection(ownerClient: OwnerClient, collectionId: string): Promise<ShareLinkRow[]> {
  const { data, error } = await ownerClient
    .from('share_links')
    .select('*')
    .eq('collection_id', collectionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as ShareLinkRow[];
}

// Data room Phase 3: viewer groups for a collection, each with the ids of the
// folders directly granted to it (descendants implied). Drives the owner-side
// group editor and the per-link group <Select>.
export async function listViewerGroups(
  ownerClient: OwnerClient,
  collectionId: string
): Promise<ViewerGroupWithFolders[]> {
  const { data: groupRows, error } = await ownerClient
    .from('viewer_groups')
    .select('*')
    .eq('collection_id', collectionId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;

  const groups = (groupRows ?? []) as ViewerGroupRow[];
  if (groups.length === 0) return [];

  const { data: grantRows, error: grantError } = await ownerClient
    .from('viewer_group_folders')
    .select('group_id, folder_id')
    .in(
      'group_id',
      groups.map((group) => group.id)
    );
  if (grantError) throw grantError;

  const grants = (grantRows ?? []) as Array<{ group_id: string; folder_id: string }>;
  const byGroup = new Map<string, string[]>();
  grants.forEach((row) => {
    const list = byGroup.get(row.group_id) ?? [];
    list.push(row.folder_id);
    byGroup.set(row.group_id, list);
  });

  return groups.map((group) => ({ ...group, folder_ids: byGroup.get(group.id) ?? [] }));
}

// The set of folder ids a viewer may see, given the folders directly granted to
// their group: every granted folder PLUS all of its descendants. Mirrors the
// recursive CTE in get_viewer_link_bundle / link_can_view_file (migration 022)
// so the SQL fast path and this JS fallback path stay behaviorally identical.
export function computeVisibleFolderIds(
  folders: Pick<FolderRow, 'id' | 'parent_folder_id'>[],
  grantedIds: Iterable<string>
): Set<string> {
  const granted = new Set(grantedIds);
  const visible = new Set<string>();
  for (const folder of folders) {
    if (granted.has(folder.id)) visible.add(folder.id);
  }
  // Iterate to a fixpoint: a folder is visible once its parent is visible.
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (!visible.has(folder.id) && folder.parent_folder_id && visible.has(folder.parent_folder_id)) {
        visible.add(folder.id);
        changed = true;
      }
    }
  }
  return visible;
}

export async function listTrashLinks(ownerClient: OwnerClient, workspaceId: string): Promise<ShareLinkTrashRow[]> {
  const { data, error } = await ownerClient
    .from('share_links')
    .select('*')
    .eq('workspace_id', workspaceId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) throw error;
  const links = (data ?? []) as ShareLinkRow[];

  if (links.length === 0) {
    return [];
  }

  const fileIds = Array.from(new Set(links.map((link) => link.file_id).filter((id): id is string => Boolean(id))));
  const collectionIds = Array.from(
    new Set(links.map((link) => link.collection_id).filter((id): id is string => Boolean(id)))
  );

  const [filesResult, collectionsResult] = await Promise.all([
    fileIds.length > 0
      ? ownerClient.from('files').select('id, original_name').in('id', fileIds)
      : Promise.resolve({ data: [], error: null }),
    collectionIds.length > 0
      ? ownerClient.from('collections').select('id, name').in('id', collectionIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (filesResult.error) throw filesResult.error;
  if (collectionsResult.error) throw collectionsResult.error;

  const fileMap = new Map<string, { id: string; original_name: string }>();
  const basicFiles = (filesResult.data ?? []) as Array<{ id: string; original_name: string }>;
  basicFiles.forEach((file) => {
    fileMap.set(file.id, { id: file.id, original_name: file.original_name });
  });

  const collectionMap = new Map<string, { id: string; name: string }>();
  const basicCollections = (collectionsResult.data ?? []) as Array<{ id: string; name: string }>;
  basicCollections.forEach((collection) => {
    collectionMap.set(collection.id, { id: collection.id, name: collection.name });
  });

  return links.map((link) => ({
    ...link,
    file: link.file_id ? fileMap.get(link.file_id) ?? null : null,
    collection: link.collection_id ? collectionMap.get(link.collection_id) ?? null : null
  }));
}

export async function getLink(ownerClient: OwnerClient, workspaceId: string, linkId: string): Promise<ShareLinkRow | null> {
  const { data, error } = await ownerClient
    .from('share_links')
    .select('*')
    .eq('id', linkId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as ShareLinkRow | null) ?? null;
}

export async function getMetricsForFile(ownerClient: OwnerClient, fileId: string) {
  const { data, error } = await ownerClient.rpc('get_owner_link_metrics' as never, {
    p_file_id: fileId
  } as never);
  if (error) throw error;

  const metrics = (data ?? []) as LinkMetrics[];
  const map = new Map<string, LinkMetrics>();
  metrics.forEach((metric) => map.set(metric.link_id, metric));
  return map;
}

/**
 * Per-link metrics — works for both file-attached and collection-attached links.
 * The get_owner_link_metrics RPC is file_id-scoped, so collection links never
 * appeared in the map and the link detail page reported unique_viewers as 0.
 *
 * Uses get_link_unique_views RPC (migration 013) — DB-side count(distinct)
 * instead of pulling every event row over the wire and reducing in JS.
 */
export async function getMetricsForLink(_ownerClient: OwnerClient, link: ShareLinkRow): Promise<LinkMetrics> {
  const admin = createAdminClient();
  const { data: unique } = await admin.rpc('get_link_unique_views', {
    p_owner_id: link.owner_id,
    p_link_id: link.id
  });

  return {
    link_id: link.id,
    // "조회수" = total opens (open_count), distinct from unique sessions.
    // Falls back to view_count for the brief window before migration 017 is
    // applied (column absent → open_count is undefined).
    views: link.open_count ?? link.view_count,
    unique_viewers: typeof unique === 'number' ? unique : Number(unique ?? 0),
    downloads: link.download_count,
    denied: link.denied_count
  };
}

export async function getDeniedBreakdown(ownerClient: OwnerClient, linkId: string): Promise<DeniedReasonCount[]> {
  const { data, error } = await ownerClient.rpc('get_denied_reason_breakdown' as never, {
    p_link_id: linkId
  } as never);
  if (error) throw error;
  return (data ?? []) as DeniedReasonCount[];
}

export async function getViewerLinkByToken(token: string): Promise<ViewerLinkBundle | null> {
  const admin = createAdminClient();

  // get_viewer_link_bundle (migration 013) returns the link + the file
  // (or collection + collection_files) as one JSONB in a single round
  // trip. Falls back to the legacy multi-query path if the RPC is not
  // yet present (e.g. before migration 013 is applied to a given env).
  const { data: bundleData, error: bundleError } = await admin.rpc('get_viewer_link_bundle', { p_token: token });
  if (!bundleError && bundleData) {
    const bundle = bundleData as {
      link: ShareLinkRow;
      file: FileRow | null;
      collection: CollectionRow | null;
      collection_files: SpaceFile[];
      folders?: FolderRow[];
    } | null;
    if (!bundle || !bundle.link) return null;
    return {
      ...bundle.link,
      file: bundle.file,
      collection: bundle.collection,
      collection_files: bundle.collection_files ?? [],
      folders: bundle.folders ?? []
    };
  }

  const { data: link, error } = await admin.from('share_links').select('*').eq('token', token).maybeSingle();
  if (error) throw error;

  if (!link) {
    return null;
  }

  let file: FileRow | null = null;
  let collection: CollectionRow | null = null;
  let collectionFiles: SpaceFile[] = [];
  let folders: FolderRow[] = [];

  // Defense-in-depth: this loader runs with the service-role client so it
  // bypasses RLS. Even though migration 012 hardens RLS so a share_links
  // row cannot be created against another owner's file/collection, a
  // legacy row inserted before that migration (or written by direct DB
  // access) could still target a foreign parent. Filter every parent
  // load by `owner_id = link.owner_id` so the viewer never serves a
  // file/collection that doesn't belong to the link's owner.
  const ownerScope = link.owner_id;

  if (link.file_id) {
    const { data: fileData, error: fileError } = await admin
      .from('files')
      .select('*')
      .eq('id', link.file_id)
      .eq('owner_id', ownerScope)
      .maybeSingle();
    if (fileError) throw fileError;
    file = (fileData as FileRow | null) ?? null;
  }

  if (link.collection_id) {
    const { data: collectionData, error: collectionError } = await admin
      .from('collections')
      .select('*')
      .eq('id', link.collection_id)
      .eq('owner_id', ownerScope)
      .maybeSingle();
    if (collectionError) throw collectionError;
    collection = (collectionData as CollectionRow | null) ?? null;

    const { data: mapping, error: mappingError } = await admin
      .from('collection_files')
      .select('file_id, sort_order, folder_id')
      .eq('collection_id', link.collection_id)
      .eq('owner_id', ownerScope)
      .order('sort_order', { ascending: true });
    if (mappingError) throw mappingError;

    const mappingRows = (mapping ?? []) as Array<{ file_id: string; folder_id: string | null }>;
    const folderByFile = new Map<string, string | null>();
    mappingRows.forEach((item) => folderByFile.set(item.file_id, item.folder_id ?? null));
    const fileIds = mappingRows.map((item) => item.file_id);
    if (fileIds.length > 0) {
      const { data: filesData, error: filesError } = await admin
        .from('files')
        .select('*')
        .in('id', fileIds)
        .eq('owner_id', ownerScope);
      if (filesError) throw filesError;

      const fileMap = new Map<string, FileRow>();
      (filesData ?? []).forEach((row) => {
        fileMap.set((row as FileRow).id, row as FileRow);
      });
      collectionFiles = fileIds
        .map((id) => {
          const f = fileMap.get(id);
          return f ? ({ ...f, folder_id: folderByFile.get(id) ?? null } as SpaceFile) : null;
        })
        .filter((row): row is SpaceFile => Boolean(row));
    }

    const { data: folderRows, error: foldersError } = await admin
      .from('folders')
      .select('*')
      .eq('collection_id', link.collection_id)
      .eq('owner_id', ownerScope)
      .order('sort_order', { ascending: true });
    if (foldersError) throw foldersError;
    folders = (folderRows ?? []) as FolderRow[];

    // Phase 3: a group-scoped link only exposes the group's permitted folders
    // (+ descendants) and, optionally, root files. Mirrors get_viewer_link_bundle's
    // SQL closure. The RPC fast path above already applies this; this keeps the
    // legacy fallback path equally safe (never widens a grouped link's access).
    if (link.viewer_group_id) {
      const [groupResult, grantResult] = await Promise.all([
        admin
          .from('viewer_groups')
          .select('include_root')
          .eq('id', link.viewer_group_id)
          .eq('owner_id', ownerScope)
          .maybeSingle(),
        admin
          .from('viewer_group_folders')
          .select('folder_id')
          .eq('group_id', link.viewer_group_id)
          .eq('owner_id', ownerScope)
      ]);
      const includeRoot = (groupResult.data?.include_root as boolean | undefined) ?? true;
      const grantedIds = ((grantResult.data ?? []) as Array<{ folder_id: string }>).map((row) => row.folder_id);
      const visible = computeVisibleFolderIds(folders, grantedIds);
      folders = folders.filter((folder) => visible.has(folder.id));
      collectionFiles = collectionFiles.filter((item) =>
        item.folder_id ? visible.has(item.folder_id) : includeRoot
      );
    }
  }

  return {
    ...(link as ShareLinkRow),
    file,
    collection,
    collection_files: collectionFiles,
    folders
  };
}

export async function claimView(input: {
  linkId: string;
  fileId: string;
  sessionId?: string;
  viewerEmail?: string;
  ipHash?: string | null;
  userAgent?: string | null;
}): Promise<{ allowed: boolean; reason: DeniedReason | null }> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('claim_view', {
    p_link_id: input.linkId,
    p_file_id: input.fileId,
    p_session_id: input.sessionId ?? null,
    p_viewer_email: input.viewerEmail ?? null,
    p_ip_hash: input.ipHash ?? null,
    p_user_agent: input.userAgent ?? null
  });

  if (error) {
    // Surface as a generic failure — the route handler treats this as
    // file_missing rather than serving the document with stale counters.
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(row?.allowed),
    reason: (row?.reason as DeniedReason | null) ?? null
  };
}

// Redis-cached fast path over claimView. After the security fix that
// claims on EVERY byte-serving request (including PDF.js Range bursts),
// the Postgres claim_view RPC — a SELECT … FOR UPDATE row lock on
// share_links — runs per chunk. claim_view is already session-deduped
// (an already-viewed session returns allowed with no counter bump), so
// once a session has successfully claimed, every later request is a
// pure "already viewed?" check. This moves that check from Postgres
// (lock + SELECT) to a Redis GET.
//
// Correctness: Redis is a CACHE, never the source of truth. The marker
// is set ONLY after a successful Postgres claim, so the fast path can
// only ever SKIP work for a session that already legitimately consumed
// its slot — exactly what claim_view itself would allow. Every failure
// mode (Redis down, marker missing/expired, read/write error) degrades
// to calling Postgres claim_view, which remains the atomic enforcer of
// max_views / one_time. The cache can never grant access that
// claim_view would deny.
const VIEW_CLAIM_MARKER_TTL_SECONDS = 60 * 60 * 6; // matches grant cookie window

function viewClaimMarkerKey(linkId: string, sessionId: string) {
  return `claim:${linkId}:${sessionId}`;
}

export async function claimViewCached(input: {
  linkId: string;
  /** Link owner — only used to key the per-owner webhook dispatch kick. */
  ownerId: string;
  fileId: string;
  sessionId?: string;
  viewerEmail?: string;
  ipHash?: string | null;
  userAgent?: string | null;
}): Promise<{ allowed: boolean; reason: DeniedReason | null }> {
  const canCache = isRedisConfigured() && Boolean(input.sessionId);
  const key = input.sessionId ? viewClaimMarkerKey(input.linkId, input.sessionId) : null;

  if (canCache && key) {
    try {
      const marked = await getRedis().get(key);
      if (marked) {
        // Session already claimed this link — skip the Postgres row lock.
        return { allowed: true, reason: null };
      }
    } catch {
      // Redis read failure → fall through to the authoritative Postgres path.
    }
  }

  const result = await claimView(input);

  if (canCache && key && result.allowed) {
    try {
      await getRedis().set(key, '1', { ex: VIEW_CLAIM_MARKER_TTL_SECONDS });
    } catch {
      // Marker write failure is harmless — the next request just re-hits
      // claim_view, which dedups to already_viewed → allowed.
    }
    // Cache-miss + allowed = a fresh 'view' row was inserted by claim_view,
    // so the outbox trigger may have queued a webhook. Kick the dispatcher.
    await kickWebhookDispatch(input.ownerId);
  }

  return result;
}

// Has this viewer session actually claimed a view of the link? The
// document/download route inserts the authoritative 'view' event on a
// successful claim. Page-dwell ingest checks this so a token holder
// can't pollute per-page analytics without ever opening the document.
// Fails OPEN on error — analytics integrity is not worth dropping legit
// dwell data during a transient DB hiccup.
export async function hasViewForSession(linkId: string, sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('link_events')
    .select('id')
    .eq('link_id', linkId)
    .eq('session_id', sessionId)
    .eq('event_type', 'view')
    .limit(1)
    .maybeSingle();
  if (error) return true; // fail open
  return Boolean(data);
}

export async function recordLinkEvent(input: {
  linkId: string;
  fileId: string;
  ownerId: string;
  workspaceId: string | null;
  eventType: LinkEventType;
  reason?: DeniedReason;
  sessionId?: string;
  viewerEmail?: string;
  ipHash?: string | null;
  userAgent?: string | null;
  pageNumber?: number | null;
  dwellMs?: number | null;
  agreementName?: string | null;
}) {
  const admin = createAdminClient();

  const { error } = await admin.from('link_events').insert({
    link_id: input.linkId,
    file_id: input.fileId,
    owner_id: input.ownerId,
    workspace_id: input.workspaceId,
    event_type: input.eventType,
    reason: input.reason,
    session_id: input.sessionId,
    viewer_email: input.viewerEmail,
    ip_hash: input.ipHash,
    user_agent: input.userAgent,
    page_number: input.pageNumber ?? null,
    dwell_ms: input.dwellMs ?? null,
    agreement_name: input.agreementName ?? null
  });

  if (error) {
    throw error;
  }

  // download / denied / email_submitted / password_failed are all
  // webhook-eligible (page_view goes through recordPageViewBatch and is
  // not). Kick the near-real-time dispatcher; coalesced + best-effort.
  await kickWebhookDispatch(input.ownerId);
}

// Batched page_view ingest: one multi-row INSERT instead of N single-row
// inserts. Shared metadata (link/owner/session/ip/ua) is constant across
// the batch; only pageNumber + dwellMs vary per row.
export async function recordPageViewBatch(input: {
  linkId: string;
  fileId: string;
  ownerId: string;
  sessionId?: string;
  viewerEmail?: string;
  ipHash?: string | null;
  userAgent?: string | null;
  workspaceId: string | null;
  events: { pageNumber: number; dwellMs: number }[];
}) {
  if (input.events.length === 0) return;
  const admin = createAdminClient();

  const rows = input.events.map((event) => ({
    link_id: input.linkId,
    file_id: input.fileId,
    owner_id: input.ownerId,
    workspace_id: input.workspaceId,
    event_type: 'page_view' as const,
    session_id: input.sessionId,
    viewer_email: input.viewerEmail,
    ip_hash: input.ipHash,
    user_agent: input.userAgent,
    page_number: event.pageNumber,
    dwell_ms: event.dwellMs
  }));

  const { error } = await admin.from('link_events').insert(rows);
  if (error) {
    throw error;
  }
}

export async function listPerPageStats(args: {
  ownerId: string;
  fileId: string;
  linkId?: string;
}): Promise<PerPageStat[]> {
  const admin = createAdminClient();

  // get_per_page_stats (migration 013) does the GROUP BY in Postgres
  // instead of streaming raw event rows + reducing in Node. Falls back
  // to the legacy in-memory aggregation if the RPC is missing (e.g. a
  // pre-013 environment), and returns [] on error so the owner page
  // renders an EmptyState instead of throwing.
  const { data, error } = await admin.rpc('get_per_page_stats', {
    p_owner_id: args.ownerId,
    p_file_id: args.fileId,
    p_link_id: args.linkId ?? undefined
  });
  if (!error && data) {
    return (
      data as Array<{
        page_number: number;
        views: number | string;
        viewers?: number | string;
        total_dwell_ms: number | string;
      }>
    ).map((row) => ({
      page_number: row.page_number,
      views: Number(row.views),
      // Pre-017 envs don't return `viewers`; fall back to the row count so
      // the UI still renders (over-counts until migration 017 is applied).
      viewers: Number(row.viewers ?? row.views),
      total_dwell_ms: Number(row.total_dwell_ms)
    }));
  }
  if (error) {
    console.error('[listPerPageStats] degraded to empty', error);
  }
  return [];
}

// Per-day engagement series for a link (migration 017). Used by the link
// detail "열람 추세" card. Service-role RPC; falls back to [] on error so
// the card renders an empty state instead of throwing.
export async function listLinkDailyViews(args: {
  ownerId: string;
  linkId: string;
  days?: number;
}): Promise<LinkDailyView[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_link_daily_views', {
    p_owner_id: args.ownerId,
    p_link_id: args.linkId,
    p_days: args.days ?? 30
  });
  if (error || !data) {
    if (error) console.error('[listLinkDailyViews] degraded to empty', error);
    return [];
  }
  return (data as Array<{ day: string; sessions: number | string; new_viewers: number | string }>).map((row) => ({
    day: row.day,
    sessions: Number(row.sessions),
    new_viewers: Number(row.new_viewers)
  }));
}

// Visitor-centric rollup for the link detail "방문자" table (migration
// 018). One row per visitor (keyed by email when collected, else session),
// newest activity first. Service-role RPC; falls back to [] on error so the
// card renders an empty state instead of throwing.
export async function listLinkVisitors(args: {
  ownerId: string;
  linkId: string;
  limit?: number;
}): Promise<LinkVisitor[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_link_visitors', {
    p_owner_id: args.ownerId,
    p_link_id: args.linkId,
    p_limit: args.limit ?? 100
  });
  if (error || !data) {
    if (error) console.error('[listLinkVisitors] degraded to empty', error);
    return [];
  }
  return (
    data as Array<{
      visitor_key: string;
      viewer_email: string | null;
      sessions: number | string;
      first_seen: string;
      last_seen: string;
      pages_viewed: number | string;
      total_dwell_ms: number | string;
      downloads: number | string;
      agreed: boolean;
    }>
  ).map((row) => ({
    visitor_key: row.visitor_key,
    viewer_email: row.viewer_email,
    sessions: Number(row.sessions),
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    pages_viewed: Number(row.pages_viewed),
    total_dwell_ms: Number(row.total_dwell_ms),
    downloads: Number(row.downloads),
    agreed: Boolean(row.agreed)
  }));
}

// ── Account-level rollups for the overview dashboard + contacts (migration
// 020). All degrade to empty/zero on error so the pages render before the
// migration is applied (same pattern as listPerPageStats / listLinkVisitors).

export async function getWorkspaceOverview(workspaceId: string): Promise<OwnerOverview> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_workspace_overview', { p_workspace_id: workspaceId });
  if (error || !data) {
    if (error) console.error('[getOwnerOverview] degraded to zero', error);
    return { opens: 0, unique_viewers: 0, downloads: 0, denied: 0 };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { opens: number | string; unique_viewers: number | string; downloads: number | string; denied: number | string }
    | undefined;
  return {
    opens: Number(row?.opens ?? 0),
    unique_viewers: Number(row?.unique_viewers ?? 0),
    downloads: Number(row?.downloads ?? 0),
    denied: Number(row?.denied ?? 0)
  };
}

export async function listWorkspaceTopDocuments(workspaceId: string, limit = 5): Promise<TopDocument[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_workspace_top_documents', { p_workspace_id: workspaceId, p_limit: limit });
  if (error || !data) {
    if (error) console.error('[listTopDocuments] degraded to empty', error);
    return [];
  }
  return (
    data as Array<{ file_id: string; original_name: string; viewers: number | string; views: number | string }>
  ).map((row) => ({
    file_id: row.file_id,
    original_name: row.original_name,
    viewers: Number(row.viewers),
    views: Number(row.views)
  }));
}

export async function listWorkspaceContacts(workspaceId: string, limit = 200): Promise<OwnerContact[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_workspace_contacts', { p_workspace_id: workspaceId, p_limit: limit });
  if (error || !data) {
    if (error) console.error('[listOwnerContacts] degraded to empty', error);
    return [];
  }
  return (
    data as Array<{
      viewer_email: string;
      documents: number | string;
      sessions: number | string;
      opens: number | string;
      downloads: number | string;
      agreed: boolean;
      first_seen: string;
      last_seen: string;
    }>
  ).map((row) => ({
    viewer_email: row.viewer_email,
    documents: Number(row.documents),
    sessions: Number(row.sessions),
    opens: Number(row.opens),
    downloads: Number(row.downloads),
    agreed: Boolean(row.agreed),
    first_seen: row.first_seen,
    last_seen: row.last_seen
  }));
}

// Recent activity feed for the overview (page_view excluded — too noisy).
export async function listRecentEvents(
  ownerClient: OwnerClient,
  workspaceId: string,
  limit = 12
): Promise<Array<{ id: number; event_type: string; reason: string | null; viewer_email: string | null; created_at: string }>> {
  const { data, error } = await ownerClient
    .from('link_events')
    .select('id, event_type, reason, viewer_email, created_at')
    .eq('workspace_id', workspaceId)
    .in('event_type', OWNER_FEED_EVENT_TYPES)
    .order('id', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as Array<{ id: number; event_type: string; reason: string | null; viewer_email: string | null; created_at: string }>;
}

// True distinct unique viewers across a whole data room's active links
// (migration 021). Replaces the per-link sum, which double-counted a visitor
// who opened more than one link of the same room.
export async function getCollectionUniqueViews(ownerId: string, collectionId: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_collection_unique_views', {
    p_owner_id: ownerId,
    p_collection_id: collectionId
  });
  if (error) {
    console.error('[getCollectionUniqueViews] degraded to 0', error);
    return 0;
  }
  return typeof data === 'number' ? data : Number(data ?? 0);
}

// Per-link distinct unique for every link of a room in one round trip
// (migration 021) — kills the N+1 of calling get_link_unique_views per link.
export async function listCollectionLinkUniques(ownerId: string, collectionId: string): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_collection_link_uniques', {
    p_owner_id: ownerId,
    p_collection_id: collectionId
  });
  if (error || !data) {
    if (error) console.error('[listCollectionLinkUniques] degraded to empty', error);
    return new Map();
  }
  return new Map(
    (data as Array<{ link_id: string; unique_viewers: number | string }>).map((row) => [row.link_id, Number(row.unique_viewers)])
  );
}

// #1: bump the total-opens counter for a link. Called once per viewer-page
// render (not per byte-range request), so it counts opens — including
// repeat opens by the same session — without inflating on PDF.js Range
// bursts. Best-effort: never block the viewer on an analytics write.
export async function bumpOpenCount(linkId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    await admin.rpc('increment_link_open_count', { p_link_id: linkId });
  } catch {
    // Swallow — opens analytics must never break document rendering.
  }
}

export async function uploadPdfObject(args: {
  path: string;
  file: File;
}) {
  const admin = createAdminClient();

  const { error } = await admin.storage.from('pdf-files').upload(args.path, args.file, {
    contentType: 'application/pdf',
    upsert: false
  });

  if (error) throw error;
}

export async function downloadPdfObject(path: string) {
  // Kept for any non-streaming caller (admin UI exports, etc). The
  // viewer / download routes now use signedPdfObjectUrl + fetch() for
  // real streaming and Range support.
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from('pdf-files').download(path);
  if (error) throw error;
  return data;
}

// Returns a short-lived signed URL pointing at the storage object, used
// by viewer/download routes to stream bytes via fetch(url) instead of
// download() (which materializes the whole Blob in Node memory). The
// upstream URL honors HTTP Range requests, so the route can pass a
// client's Range header straight through and return 206 partial bodies.
export async function signedPdfObjectUrl(path: string, ttlSeconds = 60): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from('pdf-files').createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function removePdfObject(path: string) {
  const admin = createAdminClient();
  const { error } = await admin.storage.from('pdf-files').remove([path]);
  if (error) throw error;
}

// ── File Request storage + loaders ──────────────────────────────────────────
// Inbound uploads live in a separate private bucket (broad MIME) from the
// owner's curated pdf-files. contentType is the validated MIME so the bucket's
// allowed_mime_types acts as a server-side backstop.
const REQUEST_UPLOAD_BUCKET = 'request-uploads';

export async function uploadRequestObject(args: { path: string; file: File; contentType: string }) {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(REQUEST_UPLOAD_BUCKET).upload(args.path, args.file, {
    contentType: args.contentType,
    upsert: false
  });
  if (error) throw error;
}

export async function signedRequestObjectUrl(path: string, ttlSeconds = 60): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(REQUEST_UPLOAD_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function removeRequestObject(path: string) {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(REQUEST_UPLOAD_BUCKET).remove([path]);
  if (error) throw error;
}

export async function listFileRequests(ownerClient: OwnerClient, workspaceId: string): Promise<FileRequestRow[]> {
  const { data, error } = await ownerClient
    .from('file_requests')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FileRequestRow[];
}

export async function getFileRequest(
  ownerClient: OwnerClient,
  workspaceId: string,
  requestId: string
): Promise<FileRequestRow | null> {
  const { data, error } = await ownerClient
    .from('file_requests')
    .select('*')
    .eq('id', requestId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as FileRequestRow | null) ?? null;
}

// Public upload route + page: resolve a non-deleted request by token with the
// service-role client (the visitor is anonymous). The caller MUST still gate on
// is_active / expires_at before accepting an upload.
// cache() dedupes the call across generateMetadata + the page render in one request.
export const getFileRequestByToken = cache(async (token: string): Promise<FileRequestRow | null> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('file_requests')
    .select('*')
    .eq('token', token)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as FileRequestRow | null) ?? null;
});

export async function listRequestUploads(
  ownerClient: OwnerClient,
  requestId: string
): Promise<FileRequestUploadRow[]> {
  const { data, error } = await ownerClient
    .from('file_request_uploads')
    .select('*')
    .eq('request_id', requestId)
    // Two-phase commit (migration 030): only surface uploads whose object is
    // durably stored. Unconfirmed rows are in-flight or crash-orphaned.
    .not('confirmed_at', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FileRequestUploadRow[];
}

// Orphan sweep for the dispatch cron: delete file-request upload rows that were
// inserted by the claim RPC but never confirmed (object durably stored) — i.e.
// a process crash/timeout died between the insert and the storage upload. The
// 1h floor never touches an in-flight upload (those confirm within seconds).
// The after-delete trigger restores the parent's upload_count, and any stray
// object is removed best-effort.
const REQUEST_UPLOAD_ORPHAN_AGE_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_UPLOAD_SWEEP_BATCH = 100;

export async function cleanupUnconfirmedRequestUploads(): Promise<{ removed: number }> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - REQUEST_UPLOAD_ORPHAN_AGE_MS).toISOString();
  const { data, error } = await admin
    .from('file_request_uploads')
    .select('id, storage_path, owner_id')
    .is('confirmed_at', null)
    .lt('created_at', cutoff)
    .limit(REQUEST_UPLOAD_SWEEP_BATCH);
  if (error || !data || data.length === 0) return { removed: 0 };

  let removed = 0;
  for (const row of data as Array<{ id: string; storage_path: string; owner_id: string }>) {
    // Remove the (usually-missing, occasionally-orphaned) object first.
    try {
      await admin.storage.from(REQUEST_UPLOAD_BUCKET).remove([row.storage_path]);
    } catch {
      // ignore — row delete is the source of truth; a stray object is cosmetic
    }
    const { error: delError } = await admin
      .from('file_request_uploads')
      .delete()
      .eq('id', row.id)
      .eq('owner_id', row.owner_id);
    if (!delError) removed += 1; // after-delete trigger restores upload_count
  }
  return { removed };
}

// Owner download: one upload scoped to the owner (RLS) so a signed URL can be
// minted for it.
export async function getRequestUpload(
  ownerClient: OwnerClient,
  uploadId: string
): Promise<FileRequestUploadRow | null> {
  const { data, error } = await ownerClient
    .from('file_request_uploads')
    .select('*')
    .eq('id', uploadId)
    .maybeSingle();
  if (error) throw error;
  return (data as FileRequestUploadRow | null) ?? null;
}

// ── Data room Q&A (Phase 4) ──────────────────────────────────────────────────

// Persist a viewer's question (service-role; anonymous viewer). Returns the new
// row id so the caller can fire a best-effort owner notification.
export async function insertDataRoomQuestion(input: {
  collectionId: string;
  linkId: string;
  ownerId: string;
  workspaceId: string | null;
  sessionId: string | null;
  askerEmail: string | null;
  body: string;
  ipHash: string | null;
}): Promise<{ id: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('data_room_questions')
    .insert({
      collection_id: input.collectionId,
      link_id: input.linkId,
      owner_id: input.ownerId,
      workspace_id: input.workspaceId,
      session_id: input.sessionId,
      asker_email: input.askerEmail,
      body: input.body,
      ip_hash: input.ipHash
    })
    .select('id')
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string };
}

// The viewer's OWN thread for a room — scoped to their session (service-role).
// Chronological so the conversation reads top-to-bottom. Never returns other
// viewers' questions (Q&A is private to asker + owner).
export async function listViewerQuestions(collectionId: string, sessionId: string): Promise<ViewerQuestion[]> {
  if (!sessionId) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('data_room_questions')
    .select('id, body, answer, answered_at, created_at')
    .eq('collection_id', collectionId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data as ViewerQuestion[];
}

// Every question for a data room — owner side (RLS-scoped), newest first.
export async function listCollectionQuestions(
  ownerClient: OwnerClient,
  collectionId: string
): Promise<DataRoomQuestionRow[]> {
  const { data, error } = await ownerClient
    .from('data_room_questions')
    .select('*')
    .eq('collection_id', collectionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DataRoomQuestionRow[];
}

// ── Custom branding (white-label) ───────────────────────────────────────────
const OWNER_LOGO_BUCKET = 'owner-logos';

// Public URL for a logo object (the bucket is public → no signing needed).
export function ownerLogoPublicUrl(logoPath: string): string {
  return `${publicEnv.supabaseUrl}/storage/v1/object/public/${OWNER_LOGO_BUCKET}/${logoPath}`;
}

// Resolve an owner's branding for the PUBLIC pages. Service-role read (the
// viewer/request pages are anonymous). Degrades to null on any error (e.g. the
// table not yet migrated) so the pages fall back to the default DocFlow mark.
// Returns null when no branding fields are set.
// Shared mapping for both branding scopes (account + per-room): a row with no
// fields set → null; otherwise resolve logo_path → public URL. Adding a future
// branding field (e.g. a cover image) is a one-line change here + the select.
type BrandingFields = {
  company_name: string | null;
  brand_color: string | null;
  logo_path: string | null;
  cover_image_path: string | null;
};

function toViewerBranding(row: BrandingFields | null): ViewerBranding | null {
  if (!row) return null;
  if (!row.company_name && !row.brand_color && !row.logo_path && !row.cover_image_path) return null;
  return {
    company_name: row.company_name,
    brand_color: row.brand_color,
    logo_url: row.logo_path ? ownerLogoPublicUrl(row.logo_path) : null,
    cover_image_url: row.cover_image_path ? ownerLogoPublicUrl(row.cover_image_path) : null
  };
}

// Account-level branding. cache() dedupes across generateMetadata + the page
// render in one request. Service-role read; degrades to null on any error.
export const getOwnerBranding = cache(async (ownerId: string): Promise<ViewerBranding | null> => {
  const admin = createAdminClient();
  try {
    const { data, error } = await admin
      .from('owner_branding')
      .select('company_name, brand_color, logo_path, cover_image_path')
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (error) return null;
    return toViewerBranding(data as BrandingFields | null);
  } catch {
    return null;
  }
});

// Per-data-room branding (layered over getOwnerBranding via mergeBranding).
export const getCollectionBranding = cache(async (collectionId: string): Promise<ViewerBranding | null> => {
  const admin = createAdminClient();
  try {
    const { data, error } = await admin
      .from('collection_branding')
      .select('company_name, brand_color, logo_path, cover_image_path')
      .eq('collection_id', collectionId)
      .maybeSingle();
    if (error) return null;
    return toViewerBranding(data as BrandingFields | null);
  } catch {
    return null;
  }
});

// Lightweight loader for the viewer page's generateMetadata: label + owner_id +
// collection_id (to pick room branding) — avoids loading the full bundle twice.
export const getViewerLinkMeta = cache(
  async (token: string): Promise<{ label: string; owner_id: string; collection_id: string | null } | null> => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('share_links')
      .select('label, owner_id, collection_id')
      .eq('token', token)
      .maybeSingle();
    if (error || !data) return null;
    return data as { label: string; owner_id: string; collection_id: string | null };
  }
);

export async function uploadLogoObject(args: { path: string; file: File; contentType: string }) {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(OWNER_LOGO_BUCKET).upload(args.path, args.file, {
    contentType: args.contentType,
    upsert: false
  });
  if (error) throw error;
}

export async function removeLogoObject(path: string) {
  const admin = createAdminClient();
  await admin.storage.from(OWNER_LOGO_BUCKET).remove([path]);
}

// Drain the pending_storage_deletions queue (rows enqueued when an inline
// storage delete failed during file/collection/account deletion). Without
// this the queue grows forever and "deleted" PDFs linger in storage —
// a cost + compliance gap. Called from the dispatch cron alongside the
// webhook outbox drain. Best-effort: per-row failures bump `attempts` and
// are retried on the next run; rows past MAX_ATTEMPTS are left for manual
// inspection rather than hammered forever.
const STORAGE_SWEEP_BATCH = 100;
const STORAGE_SWEEP_MAX_ATTEMPTS = 5;

export async function processPendingStorageDeletions(): Promise<{ processed: number; failed: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('pending_storage_deletions')
    .select('id, storage_path, attempts, bucket')
    .is('processed_at', null)
    .lt('attempts', STORAGE_SWEEP_MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(STORAGE_SWEEP_BATCH);

  if (error || !data || data.length === 0) {
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;
  for (const row of data as { id: number; storage_path: string; attempts: number; bucket: string | null }[]) {
    // Remove from the row's own bucket (pdf-files or request-uploads); default
    // pdf-files keeps pre-024 rows valid.
    const { error: removeError } = await admin.storage.from(row.bucket ?? 'pdf-files').remove([row.storage_path]);
    if (removeError) {
      failed += 1;
      await admin
        .from('pending_storage_deletions')
        .update({ attempts: row.attempts + 1 })
        .eq('id', row.id);
    } else {
      // Supabase remove() is idempotent (already-gone path → no error), so
      // success here means the object is gone for good.
      processed += 1;
      await admin
        .from('pending_storage_deletions')
        .update({ processed_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq('id', row.id);
    }
  }
  return { processed, failed };
}
