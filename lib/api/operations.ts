import crypto from 'node:crypto';

import { z } from 'zod';

import { publicEnv } from '@/lib/env-public';
import { generateShareToken, hashPassword, sanitizeFileName } from '@/lib/security';
import type { createAdminClient } from '@/lib/supabase/admin';
import { assertSafePublicUrl } from '@/lib/url-safety';

// ─────────────────────────────────────────────────────────────────────────────
// Shared API operation layer. One implementation per operation, called by BOTH
// the MCP JSON-RPC gateway (app/api/mcp) and the REST API (app/api/v1). Each
// operation: requires a scope, validates its input, runs against the workspace,
// and returns plain JSON. Errors throw ApiError(code, httpStatus) so each
// transport can format them its own way.
// ─────────────────────────────────────────────────────────────────────────────

export type McpScopeName =
  | 'files:read'
  | 'files:write'
  | 'links:read'
  | 'links:write'
  | 'analytics:read'
  | 'automations:read'
  | 'automations:write';

export type ApiContext = {
  admin: ReturnType<typeof createAdminClient>;
  ownerId: string;
  workspaceId: string;
  scopes: string[];
};

export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 400
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

function requireScope(ctx: ApiContext, scope: McpScopeName): void {
  if (!ctx.scopes.includes(scope)) {
    throw new ApiError('forbidden', 403);
  }
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

function viewerUrl(token: string): string {
  return `${publicEnv.appUrl}/v/${token}`;
}

// ── redaction (never leak secrets over the API) ──────────────────────────────
function redactShareLink<T extends Record<string, unknown>>(row: T): Omit<T, 'password_hash'> & { has_password: boolean } {
  const { password_hash, ...rest } = row;
  return { ...rest, has_password: Boolean(password_hash) } as Omit<T, 'password_hash'> & { has_password: boolean };
}

function redactSubscription<T extends Record<string, unknown>>(
  row: T
): Omit<T, 'signing_secret'> & { has_signing_secret: boolean } {
  const { signing_secret, ...rest } = row;
  return { ...rest, has_signing_secret: Boolean(signing_secret) } as Omit<T, 'signing_secret'> & {
    has_signing_secret: boolean;
  };
}

function parseOptionalIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError('invalid_expires_at', 400);
  }
  return date.toISOString();
}

function parseOptionalMaxViews(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError('invalid_max_views', 400);
  }
  return n;
}

function parseDomainInput(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function parsePdfBase64(raw: string): Buffer {
  const cleaned = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  try {
    return Buffer.from(cleaned, 'base64');
  } catch {
    throw new ApiError('invalid_base64', 400);
  }
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

// ── event types (subscribable webhook events) ───────────────────────────────
// Extended in Phase 2 beyond the link-event set.
export const SUBSCRIBABLE_EVENTS = [
  'view',
  'denied',
  'email_submitted',
  'password_failed',
  'download',
  'page_view',
  'agreement',
  'file_uploaded',
  'question_asked',
  'question_answered',
  'request_created',
  'request_closed',
  'member_invited',
  'member_joined',
  'member_removed'
] as const;

function parseEventTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const set = new Set(SUBSCRIBABLE_EVENTS as readonly string[]);
  const out = value.filter((v): v is string => typeof v === 'string' && set.has(v));
  return Array.from(new Set(out));
}

// ─────────────────────────────────────────────────────────────────────────────
// Operations
// ─────────────────────────────────────────────────────────────────────────────

export async function filesUpload(ctx: ApiContext, input: unknown) {
  requireScope(ctx, 'files:write');
  const schema = z.object({
    filename: z.string().min(1),
    contentBase64: z.string().min(1),
    mimeType: z.string().optional()
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApiError('invalid_params', 400);

  const fileName = parsed.data.filename.trim();
  const mimeType = (parsed.data.mimeType ?? 'application/pdf').trim().toLowerCase();
  if (!fileName.toLowerCase().endsWith('.pdf')) throw new ApiError('pdf_extension_required', 400);
  if (mimeType !== 'application/pdf') throw new ApiError('pdf_mime_required', 400);

  const buffer = parsePdfBase64(parsed.data.contentBase64);
  if (buffer.length > 50 * 1024 * 1024) throw new ApiError('file_too_large', 413);
  if (!isPdfBuffer(buffer)) throw new ApiError('invalid_pdf_file', 400);

  const fileId = crypto.randomUUID();
  const safeName = sanitizeFileName(fileName || `${fileId}.pdf`);
  const storagePath = `${ctx.ownerId}/${fileId}/${safeName}`;

  const { error: insertError } = await ctx.admin.from('files').insert({
    id: fileId,
    owner_id: ctx.ownerId,
    workspace_id: ctx.workspaceId,
    original_name: fileName,
    mime_type: 'application/pdf',
    size_bytes: buffer.length,
    storage_path: storagePath
  });
  if (insertError) throw new ApiError('file_create_failed', 500);

  const { error: uploadError } = await ctx.admin.storage
    .from('pdf-files')
    .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });
  if (uploadError) {
    await ctx.admin.from('files').delete().eq('id', fileId).eq('workspace_id', ctx.workspaceId);
    throw new ApiError('storage_failed', 500);
  }

  const { data: fileRow } = await ctx.admin
    .from('files')
    .select('id, original_name, size_bytes, mime_type, created_at, updated_at')
    .eq('id', fileId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!fileRow) throw new ApiError('file_create_failed', 500);

  return { file: fileRow, dashboardUrl: `${publicEnv.appUrl}/dashboard/files/${fileRow.id}` };
}

export async function filesList(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:read');
  const limit = clampLimit(input.limit, 100, 200);
  const { data, error } = await ctx.admin
    .from('files')
    .select('id, original_name, size_bytes, mime_type, created_at, updated_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new ApiError('internal_error', 500);
  return { files: data ?? [] };
}

export async function collectionsList(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:read');
  const limit = clampLimit(input.limit, 100, 200);
  const { data: collections, error } = await ctx.admin
    .from('collections')
    .select('id, name, description, created_at, updated_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new ApiError('internal_error', 500);

  const ids = (collections ?? []).map((c) => c.id);
  const { data: mapping } =
    ids.length === 0
      ? { data: [] }
      : await ctx.admin.from('collection_files').select('collection_id').in('collection_id', ids);
  const counts = new Map<string, number>();
  (mapping ?? []).forEach((row) => counts.set(row.collection_id, (counts.get(row.collection_id) ?? 0) + 1));

  return {
    collections: (collections ?? []).map((c) => ({ ...c, file_count: counts.get(c.id) ?? 0 }))
  };
}

export async function linksList(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'links:read');
  const limit = clampLimit(input.limit, 100, 200);
  const includeDeleted = input.includeDeleted === true;
  const targetType = typeof input.targetType === 'string' ? input.targetType : undefined;
  const targetId = typeof input.targetId === 'string' ? input.targetId : undefined;

  let query = ctx.admin
    .from('share_links')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!includeDeleted) query = query.is('deleted_at', null);
  if (targetType === 'file' && targetId) query = query.eq('file_id', targetId);
  if (targetType === 'collection' && targetId) query = query.eq('collection_id', targetId);

  const { data, error } = await query;
  if (error) throw new ApiError('internal_error', 500);
  return { links: (data ?? []).map((link) => ({ ...redactShareLink(link), url: viewerUrl(link.token as string) })) };
}

export async function linksCreate(ctx: ApiContext, input: unknown) {
  requireScope(ctx, 'links:write');
  const schema = z.object({
    targetType: z.enum(['file', 'collection']),
    targetId: z.string().min(1),
    label: z.string().min(1),
    isActive: z.boolean().optional(),
    expiresAt: z.string().optional(),
    maxViews: z.number().int().positive().optional(),
    requireEmail: z.boolean().optional(),
    allowedDomains: z.union([z.array(z.string()), z.string()]).optional(),
    allowDownload: z.boolean().optional(),
    oneTime: z.boolean().optional(),
    watermark: z.boolean().optional(),
    password: z.string().optional()
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApiError('invalid_params', 400);
  const payload = parsed.data;
  const allowedDomains = parseDomainInput(payload.allowedDomains);

  if (payload.targetType === 'file') {
    const { data: file } = await ctx.admin
      .from('files')
      .select('id')
      .eq('id', payload.targetId)
      .eq('workspace_id', ctx.workspaceId)
      .maybeSingle();
    if (!file) throw new ApiError('file_not_found', 404);
  } else {
    const { data: collection } = await ctx.admin
      .from('collections')
      .select('id')
      .eq('id', payload.targetId)
      .eq('workspace_id', ctx.workspaceId)
      .maybeSingle();
    if (!collection) throw new ApiError('collection_not_found', 404);
  }

  const token = generateShareToken();
  const passwordHash = payload.password ? await hashPassword(payload.password) : null;
  const requireEmail = payload.requireEmail === true || allowedDomains.length > 0;

  const { data: created, error } = await ctx.admin
    .from('share_links')
    .insert({
      owner_id: ctx.ownerId,
      workspace_id: ctx.workspaceId,
      file_id: payload.targetType === 'file' ? payload.targetId : null,
      collection_id: payload.targetType === 'collection' ? payload.targetId : null,
      label: payload.label,
      token,
      is_active: payload.isActive ?? true,
      expires_at: parseOptionalIsoDate(payload.expiresAt),
      max_views: parseOptionalMaxViews(payload.maxViews),
      require_email: requireEmail,
      allowed_domains: allowedDomains,
      password_hash: passwordHash,
      allow_download: payload.allowDownload ?? false,
      one_time: payload.oneTime ?? false,
      watermark: payload.watermark ?? true
    })
    .select('*')
    .maybeSingle();
  if (error || !created) throw new ApiError('link_create_failed', 500);

  return { link: { ...redactShareLink(created), url: viewerUrl(created.token as string) } };
}

export async function linksUpdate(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'links:write');
  const linkId = typeof input.linkId === 'string' ? input.linkId : '';
  if (!linkId) throw new ApiError('invalid_params', 400);

  const { data: existing } = await ctx.admin
    .from('share_links')
    .select('id, owner_id, password_hash')
    .eq('id', linkId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!existing) throw new ApiError('link_not_found', 404);

  const update: Record<string, unknown> = {};
  if (typeof input.label === 'string' && input.label.trim().length > 0) update.label = input.label.trim();
  if (typeof input.isActive === 'boolean') update.is_active = input.isActive;
  if (input.expiresAt !== undefined) update.expires_at = parseOptionalIsoDate(input.expiresAt);
  if (input.maxViews !== undefined) update.max_views = parseOptionalMaxViews(input.maxViews);
  if (typeof input.requireEmail === 'boolean') update.require_email = input.requireEmail;
  if (input.allowedDomains !== undefined) {
    const domains = parseDomainInput(input.allowedDomains);
    update.allowed_domains = domains;
    if (domains.length > 0) update.require_email = true;
  }
  if (typeof input.allowDownload === 'boolean') update.allow_download = input.allowDownload;
  if (typeof input.oneTime === 'boolean') update.one_time = input.oneTime;
  if (typeof input.watermark === 'boolean') update.watermark = input.watermark;
  if (input.clearPassword === true) update.password_hash = null;
  else if (typeof input.password === 'string' && input.password.trim().length > 0)
    update.password_hash = await hashPassword(input.password.trim());

  const { data: updated, error } = await ctx.admin
    .from('share_links')
    .update(update)
    .eq('id', linkId)
    .eq('workspace_id', ctx.workspaceId)
    .select('*')
    .maybeSingle();
  if (error || !updated) throw new ApiError('link_update_failed', 500);

  return { link: { ...redactShareLink(updated), url: viewerUrl(updated.token as string) } };
}

export async function analyticsSummary(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'analytics:read');
  const linkId = typeof input.linkId === 'string' ? input.linkId : '';
  if (!linkId) throw new ApiError('invalid_params', 400);

  // Gate the link to this workspace before the owner-scoped RPCs.
  const { data: link } = await ctx.admin
    .from('share_links')
    .select('id')
    .eq('id', linkId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!link) throw new ApiError('link_not_found', 404);

  const [{ data: summaryRows, error: e1 }, { data: breakdownRows, error: e2 }] = await Promise.all([
    ctx.admin.rpc('get_link_summary_for_owner', { p_owner_id: ctx.ownerId, p_link_id: linkId }),
    ctx.admin.rpc('get_link_denied_breakdown_for_owner', { p_owner_id: ctx.ownerId, p_link_id: linkId })
  ]);
  if (e1 || e2) throw new ApiError('internal_error', 500);
  const summary = (summaryRows ?? [])[0];
  if (!summary) throw new ApiError('link_not_found', 404);
  return { summary, deniedBreakdown: breakdownRows ?? [] };
}

export async function analyticsEvents(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'analytics:read');
  const limit = clampLimit(input.limit, 100, 500);
  const afterId = typeof input.afterId === 'number' ? input.afterId : null;
  const linkId = typeof input.linkId === 'string' ? input.linkId : null;

  let query = ctx.admin
    .from('link_events')
    .select('id, link_id, file_id, event_type, reason, session_id, viewer_email, created_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('id', { ascending: true })
    .limit(limit);
  if (linkId) query = query.eq('link_id', linkId);
  if (afterId !== null) query = query.gt('id', afterId);

  const { data, error } = await query;
  if (error) throw new ApiError('internal_error', 500);
  const rows = data ?? [];
  return { events: rows, nextCursor: rows.length > 0 ? rows[rows.length - 1].id : afterId };
}

export async function automationsSubscribe(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'automations:write');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const webhookUrlRaw = typeof input.webhookUrl === 'string' ? input.webhookUrl.trim() : '';
  const signingSecret = typeof input.signingSecret === 'string' ? input.signingSecret.trim() : '';
  const eventTypes = parseEventTypes(input.eventTypes);
  const isActive = typeof input.isActive === 'boolean' ? input.isActive : true;
  if (!name || !webhookUrlRaw) throw new ApiError('invalid_params', 400);

  if (!process.env.AUTOMATION_CRON_SECRET && !process.env.CRON_SECRET) {
    throw new ApiError('automation_dispatcher_disabled', 409);
  }
  let webhookUrl: URL;
  try {
    webhookUrl = await assertSafePublicUrl(webhookUrlRaw);
  } catch {
    throw new ApiError('invalid_webhook_url', 400);
  }

  const { data: created, error } = await ctx.admin
    .from('automation_subscriptions')
    .insert({
      owner_id: ctx.ownerId,
      workspace_id: ctx.workspaceId,
      name,
      webhook_url: webhookUrl.toString(),
      signing_secret: signingSecret || null,
      event_types: eventTypes,
      is_active: isActive
    })
    .select('*')
    .maybeSingle();
  if (error || !created) throw new ApiError('subscription_create_failed', 500);
  return { subscription: redactSubscription(created) };
}

export async function automationsList(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'automations:read');
  let query = ctx.admin
    .from('automation_subscriptions')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false });
  if (input.includeInactive !== true) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new ApiError('internal_error', 500);
  return { subscriptions: (data ?? []).map(redactSubscription) };
}

export async function automationsUnsubscribe(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'automations:write');
  const subscriptionId = typeof input.subscriptionId === 'string' ? input.subscriptionId : '';
  if (!subscriptionId) throw new ApiError('invalid_params', 400);
  const { error } = await ctx.admin
    .from('automation_subscriptions')
    .delete()
    .eq('id', subscriptionId)
    .eq('workspace_id', ctx.workspaceId);
  if (error) throw new ApiError('internal_error', 500);
  return { deleted: true, subscriptionId };
}
