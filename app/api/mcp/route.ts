import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticateMcpBearerToken, parseBearerToken } from '@/lib/agent-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  type ApiContext,
  analyticsEvents,
  analyticsSummary,
  automationsList,
  automationsSubscribe,
  automationsUnsubscribe,
  collectionsAddFiles,
  collectionsCreate,
  collectionsList,
  collectionsRemoveFile,
  contactsList,
  filesList,
  filesUpload,
  linksCreate,
  linksDelete,
  linksList,
  linksUpdate,
  questionsAnswer,
  questionsList,
  requestUploadsList,
  requestsList
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
  'docflow.collections.list': collectionsList,
  'docflow.links.list': linksList,
  'docflow.links.create': linksCreate,
  'docflow.links.update': linksUpdate,
  'docflow.analytics.summary': analyticsSummary,
  'docflow.analytics.events': analyticsEvents,
  'docflow.automations.subscribe': automationsSubscribe,
  'docflow.automations.list': automationsList,
  'docflow.automations.unsubscribe': automationsUnsubscribe,
  'docflow.links.delete': linksDelete,
  'docflow.collections.create': collectionsCreate,
  'docflow.collections.addFiles': collectionsAddFiles,
  'docflow.collections.removeFile': collectionsRemoveFile,
  'docflow.requests.list': requestsList,
  'docflow.requests.uploads': requestUploadsList,
  'docflow.questions.list': questionsList,
  'docflow.questions.answer': questionsAnswer,
  'docflow.contacts.list': contactsList
};

async function handleToolCall(
  ownerId: string,
  workspaceId: string | null,
  principalScopes: string[],
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
  return op({ admin: createAdminClient(), ownerId, workspaceId, scopes: principalScopes }, args);
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
      const result = await handleToolCall(
        principal.ownerId,
        principal.workspaceId,
        principal.scopes,
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
          'invalid_event_types'
        ].includes(message)
      ) {
        return rpcError(payload.id, -32602, 'Invalid params', message, 400);
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
        message === 'question_not_found'
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
