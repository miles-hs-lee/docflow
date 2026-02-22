import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type {
  DeniedReason,
  DeniedReasonCount,
  FileRow,
  LinkEventType,
  LinkMetrics,
  ShareLinkRow,
  ShareLinkTrashRow
} from '@/lib/types';

type OwnerClient = SupabaseClient;

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

export async function listTrashLinks(ownerClient: OwnerClient): Promise<ShareLinkTrashRow[]> {
  const { data, error } = await ownerClient
    .from('share_links')
    .select('*, file:files(id, original_name)')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as ShareLinkTrashRow[];
}

export async function getLink(ownerClient: OwnerClient, linkId: string): Promise<ShareLinkRow | null> {
  const { data, error } = await ownerClient.from('share_links').select('*').eq('id', linkId).maybeSingle();
  if (error) throw error;
  return (data as ShareLinkRow | null) ?? null;
}

export async function getMetricsForFile(ownerClient: OwnerClient, fileId: string) {
  const { data, error } = await ownerClient.rpc('get_owner_link_metrics', { p_file_id: fileId });
  if (error) throw error;

  const metrics = (data ?? []) as LinkMetrics[];
  const map = new Map<string, LinkMetrics>();
  metrics.forEach((metric) => map.set(metric.link_id, metric));
  return map;
}

export async function getDeniedBreakdown(ownerClient: OwnerClient, linkId: string): Promise<DeniedReasonCount[]> {
  const { data, error } = await ownerClient.rpc('get_denied_reason_breakdown', { p_link_id: linkId });
  if (error) throw error;
  return (data ?? []) as DeniedReasonCount[];
}

export async function getViewerLinkByToken(token: string) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('share_links')
    .select('*, file:files(*)')
    .eq('token', token)
    .maybeSingle();

  if (error) throw error;

  return (data as
    | (ShareLinkRow & {
        file: FileRow | null;
      })
    | null) ?? null;
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
