import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticateMcpBearerToken, ensureScope, parseBearerToken } from '@/lib/agent-auth';
import { publicEnv } from '@/lib/env-public';
import { generateShareToken, hashPassword, parseAllowedDomains } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';

type RpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

const eventTypeSchema = z.enum(['view', 'denied', 'email_submitted', 'password_failed', 'download']);

const tools = [
  {
    name: 'docflow.files.upload',
    description: 'Upload one PDF file',
    inputSchema: {
      type: 'object',
      required: ['filename', 'contentBase64'],
      properties: {
        filename: { type: 'string' },
        contentBase64: { type: 'string', description: 'Base64 PDF data (raw or data URI)' },
        mimeType: { type: 'string' }
      }
    }
  },
  {
    name: 'docflow.files.list',
    description: 'List owned PDF files',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      }
    }
  },
  {
    name: 'docflow.collections.list',
    description: 'List owned document bundles (collections)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      }
    }
  },
  {
    name: 'docflow.links.list',
    description: 'List share links',
    inputSchema: {
      type: 'object',
      properties: {
        targetType: { type: 'string', enum: ['file', 'collection'] },
        targetId: { type: 'string' },
        includeDeleted: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      }
    }
  },
  {
    name: 'docflow.links.create',
    description: 'Create a share link for one file or one collection',
    inputSchema: {
      type: 'object',
      required: ['targetType', 'targetId', 'label'],
      properties: {
        targetType: { type: 'string', enum: ['file', 'collection'] },
        targetId: { type: 'string' },
        label: { type: 'string' },
        isActive: { type: 'boolean' },
        expiresAt: { type: 'string', description: 'ISO datetime' },
        maxViews: { type: 'integer', minimum: 1 },
        requireEmail: { type: 'boolean' },
        allowedDomains: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
        },
        password: { type: 'string' },
        allowDownload: { type: 'boolean' },
        oneTime: { type: 'boolean' }
      }
    }
  },
  {
    name: 'docflow.links.update',
    description: 'Update policy of an existing share link',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: {
        linkId: { type: 'string' },
        label: { type: 'string' },
        isActive: { type: 'boolean' },
        expiresAt: { type: ['string', 'null'], description: 'ISO datetime or null to clear' },
        maxViews: { type: ['integer', 'null'], minimum: 1 },
        requireEmail: { type: 'boolean' },
        allowedDomains: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
        },
        password: { type: 'string' },
        clearPassword: { type: 'boolean' },
        allowDownload: { type: 'boolean' },
        oneTime: { type: 'boolean' }
      }
    }
  },
  {
    name: 'docflow.analytics.summary',
    description: 'Read summary metrics and denied breakdown for one link',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: {
        linkId: { type: 'string' }
      }
    }
  },
  {
    name: 'docflow.analytics.events',
    description: 'Read link events with cursor pagination',
    inputSchema: {
      type: 'object',
      properties: {
        linkId: { type: 'string' },
        afterId: { type: 'integer' },
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      }
    }
  },
  {
    name: 'docflow.automations.subscribe',
    description: 'Create webhook subscription for link events',
    inputSchema: {
      type: 'object',
      required: ['name', 'webhookUrl'],
      properties: {
        name: { type: 'string' },
        webhookUrl: { type: 'string' },
        signingSecret: { type: 'string' },
        eventTypes: { type: 'array', items: { type: 'string' } },
        isActive: { type: 'boolean' }
      }
    }
  },
  {
    name: 'docflow.automations.list',
    description: 'List webhook subscriptions',
    inputSchema: {
      type: 'object',
      properties: {
        includeInactive: { type: 'boolean' }
      }
    }
  },
  {
    name: 'docflow.automations.unsubscribe',
    description: 'Delete one webhook subscription',
    inputSchema: {
      type: 'object',
      required: ['subscriptionId'],
      properties: {
        subscriptionId: { type: 'string' }
      }
    }
  }
] as const;

function rpcResult(id: RpcRequest['id'], result: unknown) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id: id ?? null,
    result
  });
}

function rpcError(id: RpcRequest['id'], code: number, message: string, data?: unknown, status = 400) {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data })
      }
    },
    { status }
  );
}

function toToolResult(data: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data)
      }
    ],
    structuredContent: data
  };
}

function parseOptionalIsoDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error('invalid_expires_at');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error('invalid_expires_at');
  }
  return parsed.toISOString();
}

function parseOptionalMaxViews(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('invalid_max_views');
  }
  return value;
}

function parseDomainInput(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return parseAllowedDomains(value.filter((item): item is string => typeof item === 'string').join(','));
  }
  if (typeof value === 'string') {
    return parseAllowedDomains(value);
  }
  throw new Error('invalid_allowed_domains');
}

function parseEventTypes(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return ['view', 'denied', 'email_submitted', 'password_failed', 'download'];
  }

  const parsed = value
    .map((item) => eventTypeSchema.safeParse(item))
    .filter((item) => item.success)
    .map((item) => item.data);

  if (parsed.length === 0) {
    throw new Error('invalid_event_types');
  }

  return Array.from(new Set(parsed));
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parsePdfBase64(raw: string) {
  const trimmed = raw.trim();
  const base64Part = trimmed.startsWith('data:') ? trimmed.split(',', 2)[1] ?? '' : trimmed;
  const normalized = base64Part.replace(/\s+/g, '');

  if (!normalized) {
    throw new Error('invalid_file_data');
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.length === 0) {
    throw new Error('invalid_file_data');
  }

  return buffer;
}

function isPdfBuffer(buffer: Buffer) {
  if (buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

async function handleToolCall(ownerId: string, principalScopes: string[], name: string, args: Record<string, unknown>) {
  const admin = createAdminClient();

  if (name === 'docflow.files.upload') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'files:write');
    const schema = z.object({
      filename: z.string().min(1),
      contentBase64: z.string().min(1),
      mimeType: z.string().optional()
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error('invalid_params');
    }

    const fileName = parsed.data.filename.trim();
    const mimeType = (parsed.data.mimeType ?? 'application/pdf').trim().toLowerCase();
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      throw new Error('pdf_extension_required');
    }
    if (mimeType !== 'application/pdf') {
      throw new Error('pdf_mime_required');
    }

    const buffer = parsePdfBase64(parsed.data.contentBase64);
    const maxSizeBytes = 50 * 1024 * 1024;
    if (buffer.length > maxSizeBytes) {
      throw new Error('file_too_large');
    }
    if (!isPdfBuffer(buffer)) {
      throw new Error('invalid_pdf_file');
    }

    const fileId = crypto.randomUUID();
    const safeName = sanitizeFileName(fileName || `${fileId}.pdf`);
    const storagePath = `${ownerId}/${fileId}/${safeName}`;

    const { error: insertError } = await admin.from('files').insert({
      id: fileId,
      owner_id: ownerId,
      original_name: fileName,
      mime_type: 'application/pdf',
      size_bytes: buffer.length,
      storage_path: storagePath
    });
    if (insertError) {
      throw insertError;
    }

    const { error: uploadError } = await admin.storage.from('pdf-files').upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: false
    });
    if (uploadError) {
      await admin.from('files').delete().eq('id', fileId).eq('owner_id', ownerId);
      throw uploadError;
    }

    const { data: fileRow, error: fileError } = await admin
      .from('files')
      .select('id, original_name, size_bytes, mime_type, created_at, updated_at')
      .eq('id', fileId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (fileError || !fileRow) {
      throw fileError ?? new Error('file_create_failed');
    }

    return {
      file: fileRow,
      dashboardUrl: `${publicEnv.appUrl}/dashboard/files/${fileRow.id}`
    };
  }

  if (name === 'docflow.files.list') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'files:read');
    const limit = Math.min(Math.max(typeof args.limit === 'number' ? args.limit : 100, 1), 200);
    const { data, error } = await admin
      .from('files')
      .select('id, original_name, size_bytes, mime_type, created_at, updated_at')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { files: data ?? [] };
  }

  if (name === 'docflow.collections.list') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'files:read');
    const limit = Math.min(Math.max(typeof args.limit === 'number' ? args.limit : 100, 1), 200);

    const { data: collections, error } = await admin
      .from('collections')
      .select('id, name, description, created_at, updated_at')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const collectionIds = (collections ?? []).map((item) => item.id);
    const { data: mapping, error: mappingError } =
      collectionIds.length === 0
        ? { data: [], error: null }
        : await admin.from('collection_files').select('collection_id').in('collection_id', collectionIds);

    if (mappingError) throw mappingError;
    const countMap = new Map<string, number>();
    (mapping ?? []).forEach((row) => {
      countMap.set(row.collection_id, (countMap.get(row.collection_id) ?? 0) + 1);
    });

    return {
      collections: (collections ?? []).map((item) => ({
        ...item,
        file_count: countMap.get(item.id) ?? 0
      }))
    };
  }

  if (name === 'docflow.links.list') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'links:read');
    const limit = Math.min(Math.max(typeof args.limit === 'number' ? args.limit : 100, 1), 200);
    const includeDeleted = args.includeDeleted === true;
    const targetType = typeof args.targetType === 'string' ? args.targetType : undefined;
    const targetId = typeof args.targetId === 'string' ? args.targetId : undefined;

    let query = admin.from('share_links').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false }).limit(limit);
    if (!includeDeleted) {
      query = query.is('deleted_at', null);
    }
    if (targetType === 'file' && targetId) {
      query = query.eq('file_id', targetId);
    }
    if (targetType === 'collection' && targetId) {
      query = query.eq('collection_id', targetId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return {
      links: (data ?? []).map((link) => ({
        ...link,
        url: `${publicEnv.appUrl}/v/${link.token}`
      }))
    };
  }

  if (name === 'docflow.links.create') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'links:write');
    const schema = z.object({
      targetType: z.enum(['file', 'collection']),
      targetId: z.string().min(1),
      label: z.string().min(1),
      isActive: z.boolean().optional(),
      expiresAt: z.string().optional(),
      maxViews: z.number().int().positive().optional(),
      requireEmail: z.boolean().optional(),
      allowDownload: z.boolean().optional(),
      oneTime: z.boolean().optional(),
      password: z.string().optional()
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error('invalid_params');
    }

    const payload = parsed.data;
    const allowedDomains = parseDomainInput(args.allowedDomains);

    if (payload.targetType === 'file') {
      const { data: file, error: fileError } = await admin
        .from('files')
        .select('id')
        .eq('id', payload.targetId)
        .eq('owner_id', ownerId)
        .maybeSingle();
      if (fileError || !file) {
        throw new Error('file_not_found');
      }
    } else {
      const { data: collection, error: collectionError } = await admin
        .from('collections')
        .select('id')
        .eq('id', payload.targetId)
        .eq('owner_id', ownerId)
        .maybeSingle();
      if (collectionError || !collection) {
        throw new Error('collection_not_found');
      }
    }

    const token = generateShareToken();
    const passwordHash = payload.password ? await hashPassword(payload.password) : null;
    const expiresAt = parseOptionalIsoDate(payload.expiresAt);
    const maxViews = parseOptionalMaxViews(payload.maxViews);
    const requireEmail = payload.requireEmail === true || allowedDomains.length > 0;

    const { data: created, error } = await admin
      .from('share_links')
      .insert({
        owner_id: ownerId,
        file_id: payload.targetType === 'file' ? payload.targetId : null,
        collection_id: payload.targetType === 'collection' ? payload.targetId : null,
        label: payload.label,
        token,
        is_active: payload.isActive ?? true,
        expires_at: expiresAt,
        max_views: maxViews,
        require_email: requireEmail,
        allowed_domains: allowedDomains,
        password_hash: passwordHash,
        allow_download: payload.allowDownload ?? false,
        one_time: payload.oneTime ?? false
      })
      .select('*')
      .maybeSingle();

    if (error || !created) {
      throw error ?? new Error('link_create_failed');
    }

    return {
      link: {
        ...created,
        url: `${publicEnv.appUrl}/v/${created.token}`
      }
    };
  }

  if (name === 'docflow.links.update') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'links:write');
    const linkId = typeof args.linkId === 'string' ? args.linkId : '';
    if (!linkId) {
      throw new Error('invalid_params');
    }

    const { data: existing, error: existingError } = await admin
      .from('share_links')
      .select('id, owner_id, password_hash')
      .eq('id', linkId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (existingError || !existing) {
      throw new Error('link_not_found');
    }

    const updatePayload: Record<string, unknown> = {};

    if (typeof args.label === 'string' && args.label.trim().length > 0) {
      updatePayload.label = args.label.trim();
    }
    if (typeof args.isActive === 'boolean') {
      updatePayload.is_active = args.isActive;
    }
    if (args.expiresAt !== undefined) {
      updatePayload.expires_at = parseOptionalIsoDate(args.expiresAt);
    }
    if (args.maxViews !== undefined) {
      updatePayload.max_views = parseOptionalMaxViews(args.maxViews);
    }
    if (args.requireEmail !== undefined && typeof args.requireEmail === 'boolean') {
      updatePayload.require_email = args.requireEmail;
    }
    if (args.allowedDomains !== undefined) {
      const domains = parseDomainInput(args.allowedDomains);
      updatePayload.allowed_domains = domains;
      if (domains.length > 0) {
        updatePayload.require_email = true;
      }
    }
    if (typeof args.allowDownload === 'boolean') {
      updatePayload.allow_download = args.allowDownload;
    }
    if (typeof args.oneTime === 'boolean') {
      updatePayload.one_time = args.oneTime;
    }

    if (args.clearPassword === true) {
      updatePayload.password_hash = null;
    } else if (typeof args.password === 'string' && args.password.trim().length > 0) {
      updatePayload.password_hash = await hashPassword(args.password.trim());
    } else {
      updatePayload.password_hash = existing.password_hash;
    }

    const { data: updated, error } = await admin
      .from('share_links')
      .update(updatePayload)
      .eq('id', linkId)
      .eq('owner_id', ownerId)
      .select('*')
      .maybeSingle();

    if (error || !updated) {
      throw error ?? new Error('link_update_failed');
    }

    return {
      link: {
        ...updated,
        url: `${publicEnv.appUrl}/v/${updated.token}`
      }
    };
  }

  if (name === 'docflow.analytics.summary') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'analytics:read');
    const linkId = typeof args.linkId === 'string' ? args.linkId : '';
    if (!linkId) {
      throw new Error('invalid_params');
    }

    const [{ data: summaryRows, error: summaryError }, { data: breakdownRows, error: breakdownError }] = await Promise.all([
      admin.rpc('get_link_summary_for_owner', {
        p_owner_id: ownerId,
        p_link_id: linkId
      }),
      admin.rpc('get_link_denied_breakdown_for_owner', {
        p_owner_id: ownerId,
        p_link_id: linkId
      })
    ]);

    if (summaryError) throw summaryError;
    if (breakdownError) throw breakdownError;

    const summary = (summaryRows ?? [])[0];
    if (!summary) {
      throw new Error('link_not_found');
    }

    return {
      summary,
      deniedBreakdown: breakdownRows ?? []
    };
  }

  if (name === 'docflow.analytics.events') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'analytics:read');
    const limit = Math.min(Math.max(typeof args.limit === 'number' ? args.limit : 100, 1), 500);
    const afterId = typeof args.afterId === 'number' ? args.afterId : null;
    const linkId = typeof args.linkId === 'string' ? args.linkId : null;

    let query = admin
      .from('link_events')
      .select('id, link_id, file_id, event_type, reason, session_id, viewer_email, created_at')
      .eq('owner_id', ownerId)
      .order('id', { ascending: true })
      .limit(limit);

    if (linkId) {
      query = query.eq('link_id', linkId);
    }
    if (afterId !== null) {
      query = query.gt('id', afterId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    return {
      events: rows,
      nextCursor: rows.length > 0 ? rows[rows.length - 1].id : afterId
    };
  }

  if (name === 'docflow.automations.subscribe') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'automations:write');
    const nameValue = typeof args.name === 'string' ? args.name.trim() : '';
    const webhookUrlRaw = typeof args.webhookUrl === 'string' ? args.webhookUrl.trim() : '';
    const signingSecret = typeof args.signingSecret === 'string' ? args.signingSecret.trim() : '';
    const eventTypes = parseEventTypes(args.eventTypes);
    const isActive = typeof args.isActive === 'boolean' ? args.isActive : true;

    if (!nameValue || !webhookUrlRaw) {
      throw new Error('invalid_params');
    }

    let webhookUrl: URL;
    try {
      webhookUrl = new URL(webhookUrlRaw);
    } catch {
      throw new Error('invalid_webhook_url');
    }
    if (!['http:', 'https:'].includes(webhookUrl.protocol)) {
      throw new Error('invalid_webhook_url');
    }

    const { data: created, error } = await admin
      .from('automation_subscriptions')
      .insert({
        owner_id: ownerId,
        name: nameValue,
        webhook_url: webhookUrl.toString(),
        signing_secret: signingSecret || null,
        event_types: eventTypes,
        is_active: isActive
      })
      .select('*')
      .maybeSingle();

    if (error || !created) {
      throw error ?? new Error('subscription_create_failed');
    }

    return {
      subscription: created
    };
  }

  if (name === 'docflow.automations.list') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'automations:read');
    const includeInactive = args.includeInactive === true;

    let query = admin
      .from('automation_subscriptions')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return {
      subscriptions: data ?? []
    };
  }

  if (name === 'docflow.automations.unsubscribe') {
    ensureScope({ keyId: '', ownerId, scopes: principalScopes, label: '' }, 'automations:write');
    const subscriptionId = typeof args.subscriptionId === 'string' ? args.subscriptionId : '';
    if (!subscriptionId) {
      throw new Error('invalid_params');
    }

    const { error } = await admin
      .from('automation_subscriptions')
      .delete()
      .eq('id', subscriptionId)
      .eq('owner_id', ownerId);

    if (error) throw error;
    return {
      deleted: true,
      subscriptionId
    };
  }

  throw new Error('tool_not_found');
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    name: 'DocFlow MCP Gateway',
    endpoint: '/api/mcp',
    protocol: 'jsonrpc-2.0',
    methods: ['initialize', 'tools/list', 'tools/call']
  });
}

export async function POST(request: NextRequest) {
  let payload: RpcRequest;
  try {
    payload = (await request.json()) as RpcRequest;
  } catch {
    return rpcError(null, -32700, 'Parse error', undefined, 400);
  }

  if (!payload || payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
    return rpcError(payload?.id ?? null, -32600, 'Invalid Request', undefined, 400);
  }

  const token = parseBearerToken(request.headers.get('authorization'));
  if (!token) {
    return rpcError(payload.id, -32001, 'Unauthorized', 'Missing Bearer token', 401);
  }

  const principal = await authenticateMcpBearerToken(token);
  if (!principal) {
    return rpcError(payload.id, -32001, 'Unauthorized', 'Invalid API key', 401);
  }

  if (payload.method === 'initialize') {
    return rpcResult(payload.id, {
      protocolVersion: '2025-03-26',
      serverInfo: {
        name: 'docflow-mcp-gateway',
        version: '1.0.0'
      },
      capabilities: {
        tools: {}
      }
    });
  }

  if (payload.method === 'tools/list') {
    return rpcResult(payload.id, {
      tools
    });
  }

  if (payload.method === 'tools/call') {
    const callSchema = z.object({
      name: z.string(),
      arguments: z.record(z.unknown()).optional()
    });
    const parsed = callSchema.safeParse(payload.params);
    if (!parsed.success) {
      return rpcError(payload.id, -32602, 'Invalid params', parsed.error.flatten(), 400);
    }

    try {
      const result = await handleToolCall(principal.ownerId, principal.scopes, parsed.data.name, parsed.data.arguments ?? {});
      return rpcResult(payload.id, toToolResult(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'tool_call_failed';

      if (message.startsWith('missing_scope:')) {
        return rpcError(payload.id, -32003, 'Forbidden', message.replace('missing_scope:', ''), 403);
      }
      if (message === 'tool_not_found') {
        return rpcError(payload.id, -32601, 'Tool not found', undefined, 404);
      }
      if (message === 'invalid_params') {
        return rpcError(payload.id, -32602, 'Invalid params', undefined, 400);
      }
      if (
        [
          'pdf_extension_required',
          'pdf_mime_required',
          'invalid_file_data',
          'invalid_pdf_file',
          'invalid_expires_at',
          'invalid_max_views',
          'invalid_allowed_domains',
          'invalid_event_types'
        ].includes(message)
      ) {
        return rpcError(payload.id, -32602, 'Invalid params', message, 400);
      }
      if (message === 'file_too_large') {
        return rpcError(payload.id, -32004, 'Payload too large', message, 413);
      }

      return rpcError(payload.id, -32000, 'Tool execution failed', message, 500);
    }
  }

  return rpcError(payload.id, -32601, 'Method not found', undefined, 404);
}
