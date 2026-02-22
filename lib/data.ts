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
  ShareLinkRow,
  ShareLinkTrashRow,
  ViewerLinkBundle
} from '@/lib/types';

type OwnerClient = Awaited<ReturnType<typeof createOwnerClient>>;

export async function listFiles(ownerClient: OwnerClient): Promise<FileRow[]> {
  const { data, error } = await ownerClient
    .from('files')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as FileRow[];
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

export async function getDeniedBreakdown(ownerClient: OwnerClient, linkId: string): Promise<DeniedReasonCount[]> {
  const { data, error } = await ownerClient.rpc('get_denied_reason_breakdown' as never, {
    p_link_id: linkId
  } as never);
  if (error) throw error;
  return (data ?? []) as DeniedReasonCount[];
}

export async function getViewerLinkByToken(token: string): Promise<ViewerLinkBundle | null> {
  const admin = createAdminClient();

  const { data: link, error } = await admin.from('share_links').select('*').eq('token', token).maybeSingle();
  if (error) throw error;

  if (!link) {
    return null;
  }

  let file: FileRow | null = null;
  let collection: CollectionRow | null = null;
  let collectionFiles: FileRow[] = [];

  if (link.file_id) {
    const { data: fileData, error: fileError } = await admin.from('files').select('*').eq('id', link.file_id).maybeSingle();
    if (fileError) throw fileError;
    file = (fileData as FileRow | null) ?? null;
  }

  if (link.collection_id) {
    const { data: collectionData, error: collectionError } = await admin
      .from('collections')
      .select('*')
      .eq('id', link.collection_id)
      .maybeSingle();
    if (collectionError) throw collectionError;
    collection = (collectionData as CollectionRow | null) ?? null;

    const { data: mapping, error: mappingError } = await admin
      .from('collection_files')
      .select('file_id, sort_order')
      .eq('collection_id', link.collection_id)
      .order('sort_order', { ascending: true });
    if (mappingError) throw mappingError;

    const fileIds = (mapping ?? []).map((item) => (item as { file_id: string }).file_id);
    if (fileIds.length > 0) {
      const { data: filesData, error: filesError } = await admin.from('files').select('*').in('id', fileIds);
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
    user_agent: input.userAgent
  });

  if (error) {
    throw error;
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
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from('pdf-files').download(path);
  if (error) throw error;
  return data;
}

export async function removePdfObject(path: string) {
  const admin = createAdminClient();
  const { error } = await admin.storage.from('pdf-files').remove([path]);
  if (error) throw error;
}
