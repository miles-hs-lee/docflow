import crypto from 'node:crypto';

import { z } from 'zod';

import { publicEnv } from '@/lib/env-public';
import { notifyQuestionAnswered } from '@/lib/notify/workspace-events';
import { createLinkPreviewToken } from '@/lib/preview-token';
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
  /** API key label, surfaced by workspace.info so agents can identify the credential. */
  keyLabel?: string;
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
  // null/undefined/empty = "clear the field". A non-string (e.g. a number or
  // boolean from an untyped PATCH body) is a client error, not a silent clear.
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ApiError('invalid_expires_at', 400);
  }
  if (value.trim().length === 0) return null;
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

// Same floor as the dashboard forms (lib/actions/owner.ts) — keep the two
// write surfaces consistent so an agent can't mint weaker links than a human.
const MIN_LINK_PASSWORD_LENGTH = 4;

function parseLinkPassword(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new ApiError('invalid_password', 400);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length < MIN_LINK_PASSWORD_LENGTH) throw new ApiError('password_too_short', 400);
  return trimmed;
}

// Viewer-group scoping is collection-link only; the group must belong to the
// SAME collection in this workspace. Returns null for empty/'all'.
async function resolveViewerGroup(
  ctx: ApiContext,
  collectionId: string,
  viewerGroupId: unknown
): Promise<string | null> {
  if (viewerGroupId === null || viewerGroupId === undefined) return null;
  if (typeof viewerGroupId !== 'string' || !viewerGroupId.trim() || viewerGroupId === 'all') return null;
  const { data: group } = await ctx.admin
    .from('viewer_groups')
    .select('id')
    .eq('id', viewerGroupId)
    .eq('collection_id', collectionId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!group) throw new ApiError('viewer_group_not_found', 404);
  return group.id;
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
  // Buffer.from never throws on bad base64 (it drops invalid chars), so guard on
  // an empty result instead — that's the only signal of garbage/empty input.
  const cleaned = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) throw new ApiError('invalid_base64', 400);
  return buffer;
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
  'agreement',
  'file_uploaded',
  'question_asked',
  'question_answered',
  'request_created',
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
    .select('id, original_name, size_bytes, mime_type, page_count, created_at, updated_at')
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
    .select('id, original_name, size_bytes, mime_type, page_count, created_at, updated_at')
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
    password: z.string().optional(),
    // Clickwrap NDA gate — full policy parity with the dashboard form.
    requireAgreement: z.boolean().optional(),
    agreementText: z.string().max(5000).optional(),
    // Collection links only: scope the bundle to one viewer group.
    viewerGroupId: z.string().optional()
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
    if (payload.viewerGroupId) throw new ApiError('viewer_group_requires_collection', 400);
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
  const password = parseLinkPassword(payload.password);
  const passwordHash = password ? await hashPassword(password) : null;
  const requireEmail = payload.requireEmail === true || allowedDomains.length > 0;
  const viewerGroupId =
    payload.targetType === 'collection' ? await resolveViewerGroup(ctx, payload.targetId, payload.viewerGroupId) : null;

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
      watermark: payload.watermark ?? true,
      require_agreement: payload.requireAgreement ?? false,
      agreement_text: payload.agreementText?.trim() || null,
      viewer_group_id: viewerGroupId
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
    .select('id, owner_id, collection_id, password_hash')
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
  if (typeof input.requireAgreement === 'boolean') update.require_agreement = input.requireAgreement;
  if (input.agreementText !== undefined) {
    if (input.agreementText !== null && typeof input.agreementText !== 'string') {
      throw new ApiError('invalid_params', 400);
    }
    update.agreement_text = typeof input.agreementText === 'string' ? input.agreementText.trim().slice(0, 5000) || null : null;
  }
  if (input.viewerGroupId !== undefined) {
    if (!existing.collection_id) throw new ApiError('viewer_group_requires_collection', 400);
    update.viewer_group_id = await resolveViewerGroup(ctx, existing.collection_id, input.viewerGroupId);
  }
  if (input.clearPassword === true) update.password_hash = null;
  else if (typeof input.password === 'string' && input.password.trim().length > 0) {
    const password = parseLinkPassword(input.password);
    if (password) update.password_hash = await hashPassword(password);
  }

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
    .select('id, owner_id')
    .eq('id', linkId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!link) throw new ApiError('link_not_found', 404);

  // Use the LINK's owner (the get_link_*_for_owner RPCs are owner-scoped), so a
  // teammate-created link in this workspace is still readable via the key.
  // engagement / countries are additive (migration 039) — older deployments
  // degrade them to zero/empty rather than failing the whole summary.
  const [
    { data: summaryRows, error: e1 },
    { data: breakdownRows, error: e2 },
    { data: engagementRows },
    { data: countryRows }
  ] = await Promise.all([
    ctx.admin.rpc('get_link_summary_for_owner', { p_owner_id: link.owner_id, p_link_id: linkId }),
    ctx.admin.rpc('get_link_denied_breakdown_for_owner', { p_owner_id: link.owner_id, p_link_id: linkId }),
    ctx.admin.rpc('get_link_engagement', { p_owner_id: link.owner_id, p_link_id: linkId }),
    ctx.admin.rpc('get_link_country_breakdown', { p_owner_id: link.owner_id, p_link_id: linkId, p_limit: 20 })
  ]);
  if (e1 || e2) throw new ApiError('internal_error', 500);
  const summary = (summaryRows ?? [])[0];
  if (!summary) throw new ApiError('link_not_found', 404);
  const engagement = (engagementRows ?? [])[0] ?? { total_dwell_ms: 0, dwell_sessions: 0, avg_dwell_ms: 0 };
  return { summary, deniedBreakdown: breakdownRows ?? [], engagement, countries: countryRows ?? [] };
}

export async function analyticsEvents(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'analytics:read');
  const limit = clampLimit(input.limit, 100, 500);
  // afterId arrives as a number over MCP, a string over REST — accept both.
  const afterIdNum =
    input.afterId === undefined || input.afterId === null || input.afterId === '' ? NaN : Number(input.afterId);
  const afterId = Number.isFinite(afterIdNum) ? afterIdNum : null;
  const linkId = typeof input.linkId === 'string' ? input.linkId : null;

  let query = ctx.admin
    .from('link_events')
    .select('id, link_id, file_id, event_type, reason, session_id, viewer_email, page_number, dwell_ms, country, created_at')
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — data rooms, file requests, Q&A, contacts, link trash
// ─────────────────────────────────────────────────────────────────────────────

export async function linksDelete(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'links:write');
  const linkId = typeof input.linkId === 'string' ? input.linkId : '';
  if (!linkId) throw new ApiError('invalid_params', 400);
  const { data: existing } = await ctx.admin
    .from('share_links')
    .select('id')
    .eq('id', linkId)
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!existing) throw new ApiError('link_not_found', 404);
  const { error } = await ctx.admin
    .from('share_links')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', linkId)
    .eq('workspace_id', ctx.workspaceId);
  if (error) throw new ApiError('internal_error', 500);
  return { deleted: true, linkId };
}

export async function collectionsCreate(ctx: ApiContext, input: unknown) {
  requireScope(ctx, 'files:write');
  const schema = z.object({ name: z.string().min(1), description: z.string().optional() });
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApiError('invalid_params', 400);
  const name = parsed.data.name.trim();
  if (!name) throw new ApiError('invalid_params', 400);
  const description = parsed.data.description?.trim() || null;
  const { data, error } = await ctx.admin
    .from('collections')
    .insert({ owner_id: ctx.ownerId, workspace_id: ctx.workspaceId, name, description })
    .select('id, name, description, created_at, updated_at')
    .maybeSingle();
  if (error || !data) throw new ApiError('collection_create_failed', 500);
  return { collection: data, dashboardUrl: `${publicEnv.appUrl}/dashboard/collections/${data.id}` };
}

export async function collectionsAddFiles(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:write');
  const collectionId = typeof input.collectionId === 'string' ? input.collectionId : '';
  const fileIds = Array.isArray(input.fileIds)
    ? input.fileIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (!collectionId || fileIds.length === 0) throw new ApiError('invalid_params', 400);

  const { data: collection } = await ctx.admin
    .from('collections')
    .select('id')
    .eq('id', collectionId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!collection) throw new ApiError('collection_not_found', 404);

  const { data: ownedFiles } = await ctx.admin
    .from('files')
    .select('id')
    .in('id', fileIds)
    .eq('workspace_id', ctx.workspaceId);
  if ((ownedFiles?.length ?? 0) !== fileIds.length) throw new ApiError('file_not_found', 404);

  const { data: existing } = await ctx.admin
    .from('collection_files')
    .select('file_id, sort_order')
    .eq('collection_id', collectionId)
    .eq('workspace_id', ctx.workspaceId);
  const existingRows = (existing ?? []) as Array<{ file_id: string; sort_order: number }>;
  const existingIds = new Set(existingRows.map((row) => row.file_id));
  const maxSort = existingRows.reduce((max, row) => Math.max(max, row.sort_order ?? 0), -1);
  const toAdd = fileIds.filter((id) => !existingIds.has(id));

  if (toAdd.length > 0) {
    const rows = toAdd.map((fileId, index) => ({
      collection_id: collectionId,
      file_id: fileId,
      owner_id: ctx.ownerId,
      workspace_id: ctx.workspaceId,
      sort_order: maxSort + 1 + index
    }));
    const { error } = await ctx.admin.from('collection_files').insert(rows);
    if (error) throw new ApiError('internal_error', 500);
  }
  return { added: toAdd.length, collectionId };
}

export async function collectionsRemoveFile(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:write');
  const collectionId = typeof input.collectionId === 'string' ? input.collectionId : '';
  const fileId = typeof input.fileId === 'string' ? input.fileId : '';
  if (!collectionId || !fileId) throw new ApiError('invalid_params', 400);
  const { error } = await ctx.admin
    .from('collection_files')
    .delete()
    .eq('collection_id', collectionId)
    .eq('file_id', fileId)
    .eq('workspace_id', ctx.workspaceId);
  if (error) throw new ApiError('internal_error', 500);
  return { removed: true, collectionId, fileId };
}

export async function requestsList(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:read');
  const limit = clampLimit(input.limit, 100, 200);
  // The previous select named columns that never existed on file_requests
  // (slug, allow_multiple) — PostgREST 400s on unknown columns, so this
  // operation failed on EVERY call. Select the real schema and include the
  // public inbox URL, which is the actionable piece for an agent.
  const { data, error } = await ctx.admin
    .from('file_requests')
    .select('id, title, instructions, token, require_email, is_active, expires_at, max_uploads, upload_count, created_at, updated_at')
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new ApiError('internal_error', 500);
  return {
    requests: (data ?? []).map((row) => ({ ...row, url: `${publicEnv.appUrl}/r/${row.token}` }))
  };
}

export async function requestsCreate(ctx: ApiContext, input: unknown) {
  requireScope(ctx, 'files:write');
  const schema = z.object({
    title: z.string().min(1).max(200),
    instructions: z.string().max(2000).optional(),
    requireEmail: z.boolean().optional(),
    expiresAt: z.string().optional(),
    maxUploads: z.number().int().positive().optional()
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApiError('invalid_params', 400);

  const { data, error } = await ctx.admin
    .from('file_requests')
    .insert({
      owner_id: ctx.ownerId,
      workspace_id: ctx.workspaceId,
      token: generateShareToken(),
      title: parsed.data.title.trim(),
      instructions: parsed.data.instructions?.trim() || null,
      require_email: parsed.data.requireEmail ?? false,
      expires_at: parseOptionalIsoDate(parsed.data.expiresAt),
      max_uploads: parseOptionalMaxViews(parsed.data.maxUploads)
    })
    .select('id, title, instructions, token, require_email, is_active, expires_at, max_uploads, upload_count, created_at')
    .maybeSingle();
  if (error || !data) throw new ApiError('request_create_failed', 500);
  return { request: { ...data, url: `${publicEnv.appUrl}/r/${data.token}` } };
}

export async function requestUploadsList(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:read');
  const requestId = typeof input.requestId === 'string' ? input.requestId : '';
  if (!requestId) throw new ApiError('invalid_params', 400);
  const { data: req } = await ctx.admin
    .from('file_requests')
    .select('id')
    .eq('id', requestId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!req) throw new ApiError('request_not_found', 404);
  const { data, error } = await ctx.admin
    .from('file_request_uploads')
    .select('id, request_id, original_name, size_bytes, uploader_email, confirmed_at, created_at')
    .eq('request_id', requestId)
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw new ApiError('internal_error', 500);
  return { uploads: data ?? [] };
}

export async function questionsList(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'analytics:read');
  const limit = clampLimit(input.limit, 100, 200);
  const collectionId = typeof input.collectionId === 'string' ? input.collectionId : null;
  let query = ctx.admin
    .from('data_room_questions')
    .select('id, collection_id, body, answer, answered_at, session_id, created_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (collectionId) query = query.eq('collection_id', collectionId);
  const { data, error } = await query;
  if (error) throw new ApiError('internal_error', 500);
  return { questions: data ?? [] };
}

export async function questionsAnswer(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:write');
  const questionId = typeof input.questionId === 'string' ? input.questionId : '';
  const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
  if (!questionId || !answer) throw new ApiError('invalid_params', 400);
  const { data: existing } = await ctx.admin
    .from('data_room_questions')
    .select('id')
    .eq('id', questionId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!existing) throw new ApiError('question_not_found', 404);
  const { data, error } = await ctx.admin
    .from('data_room_questions')
    .update({ answer: answer.slice(0, 4000), answered_at: new Date().toISOString() })
    .eq('id', questionId)
    .eq('workspace_id', ctx.workspaceId)
    .select('id, collection_id, body, answer, answered_at, created_at')
    .maybeSingle();
  if (error || !data) throw new ApiError('internal_error', 500);
  await notifyQuestionAnswered({
    actorId: ctx.ownerId,
    workspaceId: ctx.workspaceId,
    collectionId: data.collection_id,
    questionId,
    createdAt: new Date().toISOString()
  });
  return { question: data };
}

export async function contactsList(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'analytics:read');
  const limit = clampLimit(input.limit, 100, 500);
  const { data, error } = await ctx.admin.rpc('get_workspace_contacts', {
    p_workspace_id: ctx.workspaceId,
    p_limit: limit
  });
  if (error) throw new ApiError('internal_error', 500);
  return { contacts: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — full-surface coverage: single-resource reads, trash lifecycle,
// owner preview, file/collection management, rich analytics, key introspection.
// Goal: an agent can operate the whole share → policy → track → follow-up loop
// without ever opening the dashboard.
// ─────────────────────────────────────────────────────────────────────────────

// Resolve a link inside this workspace (any trash state) or 404.
async function getWorkspaceLink(ctx: ApiContext, linkId: unknown, columns = '*') {
  const id = typeof linkId === 'string' ? linkId : '';
  if (!id) throw new ApiError('invalid_params', 400);
  const { data } = await ctx.admin
    .from('share_links')
    .select(columns)
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!data) throw new ApiError('link_not_found', 404);
  // Dynamic column lists defeat supabase-js's generated row types; callers
  // only read the columns they asked for.
  return data as unknown as Record<string, unknown>;
}

export async function linksGet(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'links:read');
  const link = await getWorkspaceLink(ctx, input.linkId);
  return { link: { ...redactShareLink(link), url: viewerUrl(link.token as string) } };
}

export async function linksRestore(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'links:write');
  const link = await getWorkspaceLink(ctx, input.linkId, 'id, deleted_at');
  if (!link.deleted_at) throw new ApiError('link_not_trashed', 409);
  const { data: restored, error } = await ctx.admin
    .from('share_links')
    .update({ deleted_at: null })
    .eq('id', link.id as string)
    .eq('workspace_id', ctx.workspaceId)
    .select('*')
    .maybeSingle();
  if (error || !restored) throw new ApiError('internal_error', 500);
  return { link: { ...redactShareLink(restored), url: viewerUrl(restored.token as string) } };
}

export async function linksHardDelete(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'links:write');
  const link = await getWorkspaceLink(ctx, input.linkId, 'id, deleted_at');
  // Mirror the dashboard's two-step lifecycle: only trashed links can be
  // permanently destroyed, so a single API call can't skip the safety net.
  if (!link.deleted_at) throw new ApiError('link_not_trashed', 409);
  const { data, error } = await ctx.admin.rpc('hard_delete_link', {
    p_link_id: link.id as string,
    p_workspace_id: ctx.workspaceId
  });
  if (error) throw new ApiError('internal_error', 500);
  if (data !== true) throw new ApiError('link_not_found', 404);
  return { deleted: true, permanent: true, linkId: link.id };
}

export async function linksPreview(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'links:read');
  const link = await getWorkspaceLink(ctx, input.linkId, 'id, token');
  // Same signed token the dashboard preview button mints: viewer-identical
  // render, gates bypassed, nothing counted, no policy slots consumed.
  const previewToken = createLinkPreviewToken(link.id as string);
  return {
    url: `${viewerUrl(link.token as string)}?preview=${encodeURIComponent(previewToken)}`,
    expiresInSeconds: 15 * 60,
    countsInAnalytics: false
  };
}

export async function filesGet(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:read');
  const fileId = typeof input.fileId === 'string' ? input.fileId : '';
  if (!fileId) throw new ApiError('invalid_params', 400);
  const { data: file } = await ctx.admin
    .from('files')
    .select('id, original_name, size_bytes, mime_type, page_count, storage_path, created_at, updated_at')
    .eq('id', fileId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!file) throw new ApiError('file_not_found', 404);

  // Optional short-lived signed URL so an agent can fetch the bytes without
  // a share link (files:read already implies content access — uploads come
  // in through the same scope's files:write).
  let downloadUrl: string | null = null;
  if (input.includeDownloadUrl === true) {
    const { data: signed } = await ctx.admin.storage.from('pdf-files').createSignedUrl(file.storage_path, 300);
    downloadUrl = signed?.signedUrl ?? null;
  }
  // Strip storage_path — internal bucket layout, not part of the API surface.
  const publicFile = {
    id: file.id,
    original_name: file.original_name,
    size_bytes: file.size_bytes,
    mime_type: file.mime_type,
    page_count: file.page_count,
    created_at: file.created_at,
    updated_at: file.updated_at
  };
  return { file: publicFile, downloadUrl, downloadUrlExpiresInSeconds: downloadUrl ? 300 : null };
}

export async function filesDelete(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:write');
  const fileId = typeof input.fileId === 'string' ? input.fileId : '';
  if (!fileId) throw new ApiError('invalid_params', 400);
  const { data, error } = await ctx.admin.rpc('delete_file_cascade', {
    p_file_id: fileId,
    p_workspace_id: ctx.workspaceId
  });
  if (error) throw new ApiError('internal_error', 500);
  const status = (Array.isArray(data) ? data[0] : data)?.status;
  if (status === 'not_found') throw new ApiError('file_not_found', 404);
  if (status === 'active_links_exist' || status === 'active_collection_links_exist') {
    // Same guard the dashboard enforces: trash/deactivate the links first.
    throw new ApiError(status, 409);
  }
  if (status !== 'ok') throw new ApiError('internal_error', 500);
  return { deleted: true, fileId };
}

export async function collectionsGet(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:read');
  const collectionId = typeof input.collectionId === 'string' ? input.collectionId : '';
  if (!collectionId) throw new ApiError('invalid_params', 400);
  const { data: collection } = await ctx.admin
    .from('collections')
    .select('id, name, description, created_at, updated_at')
    .eq('id', collectionId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!collection) throw new ApiError('collection_not_found', 404);

  const [{ data: mapping }, { data: folders }] = await Promise.all([
    ctx.admin
      .from('collection_files')
      .select('file_id, folder_id, sort_order')
      .eq('collection_id', collectionId)
      .eq('workspace_id', ctx.workspaceId)
      .order('sort_order', { ascending: true }),
    ctx.admin
      .from('folders')
      .select('id, name, parent_folder_id, sort_order')
      .eq('collection_id', collectionId)
      .eq('workspace_id', ctx.workspaceId)
      .order('sort_order', { ascending: true })
  ]);

  const fileIds = (mapping ?? []).map((row) => row.file_id);
  const { data: files } =
    fileIds.length === 0
      ? { data: [] }
      : await ctx.admin
          .from('files')
          .select('id, original_name, size_bytes, mime_type, page_count, created_at')
          .in('id', fileIds)
          .eq('workspace_id', ctx.workspaceId);
  const fileMap = new Map((files ?? []).map((file) => [file.id, file]));

  return {
    collection,
    folders: folders ?? [],
    files: (mapping ?? [])
      .map((row) => {
        const file = fileMap.get(row.file_id);
        return file ? { ...file, folder_id: row.folder_id, sort_order: row.sort_order } : null;
      })
      .filter(Boolean)
  };
}

export async function collectionsUpdate(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:write');
  const collectionId = typeof input.collectionId === 'string' ? input.collectionId : '';
  if (!collectionId) throw new ApiError('invalid_params', 400);
  const update: Record<string, unknown> = {};
  if (typeof input.name === 'string' && input.name.trim().length > 0) update.name = input.name.trim();
  if (input.description !== undefined) {
    if (input.description !== null && typeof input.description !== 'string') throw new ApiError('invalid_params', 400);
    update.description = typeof input.description === 'string' ? input.description.trim() || null : null;
  }
  if (Object.keys(update).length === 0) throw new ApiError('invalid_params', 400);
  const { data, error } = await ctx.admin
    .from('collections')
    .update(update)
    .eq('id', collectionId)
    .eq('workspace_id', ctx.workspaceId)
    .select('id, name, description, created_at, updated_at')
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 500);
  if (!data) throw new ApiError('collection_not_found', 404);
  return { collection: data };
}

export async function collectionsDelete(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:write');
  const collectionId = typeof input.collectionId === 'string' ? input.collectionId : '';
  if (!collectionId) throw new ApiError('invalid_params', 400);
  const { data, error } = await ctx.admin.rpc('delete_collection_cascade', {
    p_collection_id: collectionId,
    p_workspace_id: ctx.workspaceId
  });
  if (error) throw new ApiError('internal_error', 500);
  const status = (Array.isArray(data) ? data[0] : data)?.status;
  if (status === 'not_found') throw new ApiError('collection_not_found', 404);
  if (status === 'active_links_exist') throw new ApiError(status, 409);
  if (status !== 'ok') throw new ApiError('internal_error', 500);
  return { deleted: true, collectionId };
}

export async function questionsDelete(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'files:write');
  const questionId = typeof input.questionId === 'string' ? input.questionId : '';
  if (!questionId) throw new ApiError('invalid_params', 400);
  const { data, error } = await ctx.admin
    .from('data_room_questions')
    .delete()
    .eq('id', questionId)
    .eq('workspace_id', ctx.workspaceId)
    .select('id')
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 500);
  if (!data) throw new ApiError('question_not_found', 404);
  return { deleted: true, questionId };
}

// ── rich analytics (matches the dashboard link detail page) ─────────────────

async function getLinkForAnalytics(ctx: ApiContext, linkId: unknown) {
  const link = await getWorkspaceLink(ctx, linkId, 'id, owner_id, file_id, collection_id');
  return link as { id: string; owner_id: string; file_id: string | null; collection_id: string | null };
}

export async function analyticsVisitors(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'analytics:read');
  const link = await getLinkForAnalytics(ctx, input.linkId);
  const limit = clampLimit(input.limit, 100, 200);
  const { data, error } = await ctx.admin.rpc('get_link_visitors', {
    p_owner_id: link.owner_id,
    p_link_id: link.id,
    p_limit: limit
  });
  if (error) throw new ApiError('internal_error', 500);
  return { visitors: data ?? [] };
}

export async function analyticsPages(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'analytics:read');
  const link = await getLinkForAnalytics(ctx, input.linkId);

  // File links default to their file; data-room links span files, so the
  // caller must say which one (page numbers are file-scoped).
  let fileId = typeof input.fileId === 'string' && input.fileId ? input.fileId : null;
  if (link.file_id) {
    if (fileId && fileId !== link.file_id) throw new ApiError('file_not_found', 404);
    fileId = link.file_id;
  } else if (link.collection_id) {
    if (!fileId) throw new ApiError('file_id_required_for_collection_link', 400);
    const { data: member } = await ctx.admin
      .from('collection_files')
      .select('file_id')
      .eq('collection_id', link.collection_id)
      .eq('file_id', fileId)
      .eq('workspace_id', ctx.workspaceId)
      .maybeSingle();
    if (!member) throw new ApiError('file_not_found', 404);
  }
  if (!fileId) throw new ApiError('file_not_found', 404);

  const [{ data: pages, error }, { data: fileRow }] = await Promise.all([
    ctx.admin.rpc('get_per_page_stats', { p_owner_id: link.owner_id, p_file_id: fileId, p_link_id: link.id }),
    ctx.admin.from('files').select('page_count').eq('id', fileId).maybeSingle()
  ]);
  if (error) throw new ApiError('internal_error', 500);
  return { fileId, pageCount: fileRow?.page_count ?? null, pages: pages ?? [] };
}

export async function analyticsDaily(ctx: ApiContext, input: Record<string, unknown>) {
  requireScope(ctx, 'analytics:read');
  const link = await getLinkForAnalytics(ctx, input.linkId);
  const days = clampLimit(input.days, 30, 365);
  const tz = typeof input.tz === 'string' && input.tz.trim() ? input.tz.trim() : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new ApiError('invalid_timezone', 400);
  }
  const { data, error } = await ctx.admin.rpc('get_link_daily_views', {
    p_owner_id: link.owner_id,
    p_link_id: link.id,
    p_days: days,
    p_tz: tz
  });
  if (error) throw new ApiError('internal_error', 500);
  return { days, tz, series: data ?? [] };
}

// ── key/workspace introspection ──────────────────────────────────────────────
// No scope requirement: any authenticated key may inspect its own context.
// This is the first call an agent should make — it answers "who am I, where
// am I writing, and what am I allowed to do" without trial-and-error.
export async function workspaceInfo(ctx: ApiContext) {
  const { data: workspace } = await ctx.admin
    .from('workspaces')
    .select('id, name, created_at')
    .eq('id', ctx.workspaceId)
    .maybeSingle();
  if (!workspace) throw new ApiError('workspace_not_found', 404);
  return {
    workspace,
    keyLabel: ctx.keyLabel ?? null,
    scopes: ctx.scopes,
    appUrl: publicEnv.appUrl
  };
}
