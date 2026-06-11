import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticateMcpBearerToken, parseBearerToken } from '@/lib/agent-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  type ApiContext,
  analyticsDaily,
  analyticsEvents,
  analyticsPages,
  analyticsSummary,
  analyticsVisitors,
  automationsList,
  automationsSubscribe,
  automationsUnsubscribe,
  collectionsAddFiles,
  collectionsCreate,
  collectionsDelete,
  collectionsGet,
  collectionsList,
  collectionsRemoveFile,
  collectionsUpdate,
  contactsList,
  filesDelete,
  filesGet,
  filesList,
  filesUpload,
  linksCreate,
  linksDelete,
  linksGet,
  linksHardDelete,
  linksList,
  linksPreview,
  linksRestore,
  linksUpdate,
  questionsAnswer,
  questionsDelete,
  questionsList,
  requestUploadsList,
  requestsCreate,
  requestsList,
  workspaceInfo
} from '@/lib/api/operations';

type RpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

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
  },
  {
    name: 'docflow.links.delete',
    description: 'Move a share link to the trash (soft delete)',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: { linkId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.collections.create',
    description: 'Create an empty data room (collection)',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, description: { type: 'string' } }
    }
  },
  {
    name: 'docflow.collections.addFiles',
    description: 'Add existing files to a data room',
    inputSchema: {
      type: 'object',
      required: ['collectionId', 'fileIds'],
      properties: {
        collectionId: { type: 'string' },
        fileIds: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'docflow.collections.removeFile',
    description: 'Remove (unlink) one file from a data room',
    inputSchema: {
      type: 'object',
      required: ['collectionId', 'fileId'],
      properties: { collectionId: { type: 'string' }, fileId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.requests.list',
    description: 'List file-request inboxes',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }
    }
  },
  {
    name: 'docflow.requests.uploads',
    description: 'List uploads received by one file request',
    inputSchema: {
      type: 'object',
      required: ['requestId'],
      properties: { requestId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.questions.list',
    description: 'List data-room questions (optionally one room)',
    inputSchema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      }
    }
  },
  {
    name: 'docflow.questions.answer',
    description: 'Answer one data-room question',
    inputSchema: {
      type: 'object',
      required: ['questionId', 'answer'],
      properties: { questionId: { type: 'string' }, answer: { type: 'string' } }
    }
  },
  {
    name: 'docflow.contacts.list',
    description: 'List captured viewer contacts',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } }
    }
  },
  {
    name: 'docflow.workspace.info',
    description: 'Identify this API key: workspace, key label, granted scopes. Call this first.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'docflow.links.get',
    description: 'Read one share link (full policy + viewer URL)',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: { linkId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.links.restore',
    description: 'Restore a trashed share link',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: { linkId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.links.hardDelete',
    description: 'Permanently delete a TRASHED share link (must be trashed first via links.delete)',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: { linkId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.links.preview',
    description: 'Mint a 15-minute owner-preview URL: renders like a viewer but bypasses gates and records no analytics',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: { linkId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.files.get',
    description: 'Read one file; optionally include a 5-minute signed download URL',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: {
        fileId: { type: 'string' },
        includeDownloadUrl: { type: 'boolean' }
      }
    }
  },
  {
    name: 'docflow.files.delete',
    description: 'Delete a file (fails with 409 while active links reference it)',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: { fileId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.collections.get',
    description: 'Read one data room: metadata, folders, and contained files',
    inputSchema: {
      type: 'object',
      required: ['collectionId'],
      properties: { collectionId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.collections.update',
    description: 'Rename a data room or change its description',
    inputSchema: {
      type: 'object',
      required: ['collectionId'],
      properties: {
        collectionId: { type: 'string' },
        name: { type: 'string' },
        description: { type: ['string', 'null'] }
      }
    }
  },
  {
    name: 'docflow.collections.delete',
    description: 'Delete a data room (fails with 409 while active links reference it)',
    inputSchema: {
      type: 'object',
      required: ['collectionId'],
      properties: { collectionId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.requests.create',
    description: 'Create a public file-request inbox (reverse sharing: receive files from outsiders)',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        instructions: { type: 'string' },
        requireEmail: { type: 'boolean' },
        expiresAt: { type: 'string', description: 'ISO datetime' },
        maxUploads: { type: 'integer', minimum: 1 }
      }
    }
  },
  {
    name: 'docflow.questions.delete',
    description: 'Delete one data-room question',
    inputSchema: {
      type: 'object',
      required: ['questionId'],
      properties: { questionId: { type: 'string' } }
    }
  },
  {
    name: 'docflow.analytics.visitors',
    description: 'Per-visitor rollup for one link: sessions, pages read, dwell, downloads, NDA, country, device UA',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: {
        linkId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      }
    }
  },
  {
    name: 'docflow.analytics.pages',
    description: 'Per-page heatmap for one link (views, distinct viewers, dwell). Collection links require fileId',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: {
        linkId: { type: 'string' },
        fileId: { type: 'string' }
      }
    }
  },
  {
    name: 'docflow.analytics.daily',
    description: 'Daily engagement series for one link (sessions + new viewers per day)',
    inputSchema: {
      type: 'object',
      required: ['linkId'],
      properties: {
        linkId: { type: 'string' },
        days: { type: 'integer', minimum: 1, maximum: 365 },
        tz: { type: 'string', description: 'IANA timezone for day buckets (default UTC)' }
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

// Wrap an operation's JSON result in the MCP tool-result envelope.
function toToolResult(result: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

// Tool name → shared operation. Both the MCP gateway and the REST API
// (app/api/v1) call the same implementations in lib/api/operations.ts.
const OPERATIONS: Record<string, (ctx: ApiContext, input: Record<string, unknown>) => Promise<unknown>> = {
  'docflow.files.upload': filesUpload,
  'docflow.files.list': filesList,
  'docflow.files.get': filesGet,
  'docflow.files.delete': filesDelete,
  'docflow.collections.list': collectionsList,
  'docflow.links.list': linksList,
  'docflow.links.get': linksGet,
  'docflow.links.create': linksCreate,
  'docflow.links.update': linksUpdate,
  'docflow.links.restore': linksRestore,
  'docflow.links.hardDelete': linksHardDelete,
  'docflow.links.preview': linksPreview,
  'docflow.analytics.summary': analyticsSummary,
  'docflow.analytics.events': analyticsEvents,
  'docflow.analytics.visitors': analyticsVisitors,
  'docflow.analytics.pages': analyticsPages,
  'docflow.analytics.daily': analyticsDaily,
  'docflow.automations.subscribe': automationsSubscribe,
  'docflow.automations.list': automationsList,
  'docflow.automations.unsubscribe': automationsUnsubscribe,
  'docflow.links.delete': linksDelete,
  'docflow.collections.create': collectionsCreate,
  'docflow.collections.get': collectionsGet,
  'docflow.collections.update': collectionsUpdate,
  'docflow.collections.delete': collectionsDelete,
  'docflow.collections.addFiles': collectionsAddFiles,
  'docflow.collections.removeFile': collectionsRemoveFile,
  'docflow.requests.list': requestsList,
  'docflow.requests.create': requestsCreate,
  'docflow.requests.uploads': requestUploadsList,
  'docflow.questions.list': questionsList,
  'docflow.questions.answer': questionsAnswer,
  'docflow.questions.delete': questionsDelete,
  'docflow.contacts.list': contactsList,
  'docflow.workspace.info': workspaceInfo
};

async function handleToolCall(
  ownerId: string,
  workspaceId: string | null,
  principalScopes: string[],
  keyLabel: string,
  name: string,
  args: Record<string, unknown>
) {
  if (!workspaceId) {
    throw new Error('이 API 키에 연결된 워크스페이스를 찾을 수 없습니다.');
  }
  const op = OPERATIONS[name];
  if (!op) {
    throw new Error('tool_not_found');
  }
  return op({ admin: createAdminClient(), ownerId, workspaceId, scopes: principalScopes, keyLabel }, args);
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

  // Rate limit per API key (post-auth so an invalid key can't consume a
  // real key's budget, and the key id is non-sensitive).
  const rl = await checkRateLimit('mcp', principal.keyId);
  if (!rl.allowed) {
    return rpcError(payload.id, -32002, 'Rate limited', `Retry after ${rl.retryAfterSeconds}s`, 429);
  }

  // JSON-RPC notifications (no id, e.g. the spec-mandated
  // notifications/initialized handshake) expect NO response body. Answering
  // them with "Method not found" broke strict MCP clients mid-handshake —
  // acknowledge with 202 and move on.
  if (payload.method.startsWith('notifications/')) {
    return new NextResponse(null, { status: 202 });
  }

  if (payload.method === 'ping') {
    return rpcResult(payload.id, {});
  }

  if (payload.method === 'initialize') {
    // Echo a client-proposed protocol version when it's one we can serve;
    // otherwise answer with our latest supported revision (per MCP spec the
    // client then decides whether to proceed or disconnect).
    const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
    const requested =
      typeof payload.params === 'object' && payload.params !== null
        ? (payload.params as { protocolVersion?: unknown }).protocolVersion
        : undefined;
    const protocolVersion =
      typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
    return rpcResult(payload.id, {
      protocolVersion,
      serverInfo: {
        name: 'docflow-mcp-gateway',
        version: '1.1.0'
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
      const result = await handleToolCall(
        principal.ownerId,
        principal.workspaceId,
        principal.scopes,
        principal.label,
        parsed.data.name,
        parsed.data.arguments ?? {}
      );
      return rpcResult(payload.id, toToolResult(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'tool_call_failed';

      if (message === 'forbidden') {
        return rpcError(payload.id, -32003, 'Forbidden', message, 403);
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
          'invalid_base64',
          'invalid_pdf_file',
          'invalid_expires_at',
          'invalid_max_views',
          'invalid_allowed_domains',
          'invalid_event_types',
          'invalid_password',
          'password_too_short',
          'invalid_timezone',
          'file_id_required_for_collection_link',
          'viewer_group_requires_collection'
        ].includes(message)
      ) {
        return rpcError(payload.id, -32602, 'Invalid params', message, 400);
      }
      if (['link_not_trashed', 'active_links_exist', 'active_collection_links_exist'].includes(message)) {
        // The resource exists but its current state forbids the operation
        // (e.g. hard-deleting a live link, deleting a file with active
        // links). Conflict — the agent should change state first, not retry.
        return rpcError(payload.id, -32009, 'Conflict', message, 409);
      }
      if (message === 'file_too_large') {
        return rpcError(payload.id, -32004, 'Payload too large', message, 413);
      }
      if (message === 'invalid_webhook_url') {
        return rpcError(payload.id, -32602, 'Invalid params', message, 400);
      }
      if (
        message === 'file_not_found' ||
        message === 'collection_not_found' ||
        message === 'link_not_found' ||
        message === 'request_not_found' ||
        message === 'question_not_found' ||
        message === 'viewer_group_not_found' ||
        message === 'workspace_not_found'
      ) {
        // Caller referenced a parent/link that doesn't exist (or doesn't
        // belong to this owner). Distinct from a server fault — the MCP
        // client should surface "no such record" rather than retry.
        return rpcError(payload.id, -32602, 'Not found', message, 404);
      }
      if (message === 'automation_dispatcher_disabled') {
        // Distinct from a server fault: the request was well-formed but the
        // operator has not enabled the cron dispatcher. 503 communicates
        // "service is paused, retry later or ask the operator" to the MCP
        // client; -32011 is in the application-defined range so clients can
        // map this to a configuration prompt instead of a generic retry.
        return rpcError(
          payload.id,
          -32011,
          'Automation dispatcher disabled',
          'AUTOMATION_CRON_SECRET (or CRON_SECRET) is not set on the server. Subscriptions cannot be created until the operator enables the dispatcher.',
          503
        );
      }

      return rpcError(payload.id, -32000, 'Tool execution failed', message, 500);
    }
  }

  return rpcError(payload.id, -32601, 'Method not found', undefined, 404);
}
