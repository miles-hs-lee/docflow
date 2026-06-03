import { createAdminClient } from '@/lib/supabase/admin';
import type { createClient as createOwnerClient } from '@/lib/supabase/server';
import type {
  AutomationSubscriptionRow,
  CollectionRow,
  CollectionSummaryRow,
  DeniedReason,
  DeniedReasonCount,
  FileRow,
  LinkEventRow,
  LinkEventType,
  LinkMetrics,
  McpApiKeyRow,
  PerPageStat,
  ShareLinkRow,
  ShareLinkTrashRow,
  ViewerLinkBundle
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
  options: ListFilesOptions = {}
): Promise<{ rows: FileRow[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(options.limit ?? FILES_PAGE_SIZE_DEFAULT, 1), FILES_PAGE_SIZE_MAX);
  const offset = Math.max(options.offset ?? 0, 0);
  const sortKey: FilesSortKey = options.sortKey ?? 'created_at';
  const sortDir: FilesSortDir = options.sortDir ?? (sortKey === 'original_name' ? 'asc' : 'desc');
  const search = (options.search ?? '').trim();

  let query = ownerClient.from('files').select('*', { count: 'exact' });
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

export async function getFile(ownerClient: OwnerClient, fileId: string): Promise<FileRow | null> {
  const { data, error } = await ownerClient.from('files').select('*').eq('id', fileId).maybeSingle();
  if (error) throw error;
  return (data as FileRow | null) ?? null;
}

export async function listCollections(ownerClient: OwnerClient): Promise<CollectionSummaryRow[]> {
  const { data: collections, error } = await ownerClient.from('collections').select('*').order('created_at', { ascending: false });
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

export async function listMcpApiKeys(ownerClient: OwnerClient): Promise<McpApiKeyRow[]> {
  const { data, error } = await ownerClient
    .from('mcp_api_keys')
    .select('id, owner_id, label, key_prefix, scopes, last_used_at, revoked_at, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as McpApiKeyRow[];
}

export async function listAutomationSubscriptions(ownerClient: OwnerClient): Promise<AutomationSubscriptionRow[]> {
  const { data, error } = await ownerClient.from('automation_subscriptions').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AutomationSubscriptionRow[];
}

export async function listLinkEventsForOwner(ownerClient: OwnerClient, options?: {
  linkId?: string;
  afterId?: number;
  limit?: number;
}): Promise<LinkEventRow[]> {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  let query = ownerClient
    .from('link_events')
    .select('*')
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

export async function getCollection(ownerClient: OwnerClient, collectionId: string): Promise<CollectionRow | null> {
  const { data, error } = await ownerClient.from('collections').select('*').eq('id', collectionId).maybeSingle();
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

export async function listTrashLinks(ownerClient: OwnerClient): Promise<ShareLinkTrashRow[]> {
  const { data, error } = await ownerClient
    .from('share_links')
    .select('*')
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

export async function getLink(ownerClient: OwnerClient, linkId: string): Promise<ShareLinkRow | null> {
  const { data, error } = await ownerClient.from('share_links').select('*').eq('id', linkId).maybeSingle();
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
    views: link.view_count,
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
      collection_files: FileRow[];
    } | null;
    if (!bundle || !bundle.link) return null;
    return {
      ...bundle.link,
      file: bundle.file,
      collection: bundle.collection,
      collection_files: bundle.collection_files ?? []
    };
  }

  const { data: link, error } = await admin.from('share_links').select('*').eq('token', token).maybeSingle();
  if (error) throw error;

  if (!link) {
    return null;
  }

  let file: FileRow | null = null;
  let collection: CollectionRow | null = null;
  let collectionFiles: FileRow[] = [];

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
      .select('file_id, sort_order')
      .eq('collection_id', link.collection_id)
      .eq('owner_id', ownerScope)
      .order('sort_order', { ascending: true });
    if (mappingError) throw mappingError;

    const fileIds = (mapping ?? []).map((item) => (item as { file_id: string }).file_id);
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
      collectionFiles = fileIds.map((id) => fileMap.get(id)).filter((row): row is FileRow => Boolean(row));
    }
  }

  return {
    ...(link as ShareLinkRow),
    file,
    collection,
    collection_files: collectionFiles
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

export async function recordLinkEvent(input: {
  linkId: string;
  fileId: string;
  ownerId: string;
  eventType: LinkEventType;
  reason?: DeniedReason;
  sessionId?: string;
  viewerEmail?: string;
  ipHash?: string | null;
  userAgent?: string | null;
  pageNumber?: number | null;
  dwellMs?: number | null;
}) {
  const admin = createAdminClient();

  const { error } = await admin.from('link_events').insert({
    link_id: input.linkId,
    file_id: input.fileId,
    owner_id: input.ownerId,
    event_type: input.eventType,
    reason: input.reason,
    session_id: input.sessionId,
    viewer_email: input.viewerEmail,
    ip_hash: input.ipHash,
    user_agent: input.userAgent,
    page_number: input.pageNumber ?? null,
    dwell_ms: input.dwellMs ?? null
  });

  if (error) {
    throw error;
  }
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
  events: { pageNumber: number; dwellMs: number }[];
}) {
  if (input.events.length === 0) return;
  const admin = createAdminClient();

  const rows = input.events.map((event) => ({
    link_id: input.linkId,
    file_id: input.fileId,
    owner_id: input.ownerId,
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
    return (data as Array<{ page_number: number; views: number | string; total_dwell_ms: number | string }>).map(
      (row) => ({
        page_number: row.page_number,
        views: Number(row.views),
        total_dwell_ms: Number(row.total_dwell_ms)
      })
    );
  }
  if (error) {
    console.error('[listPerPageStats] degraded to empty', error);
  }
  return [];
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
