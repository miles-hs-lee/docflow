import { NextResponse } from 'next/server';

import { authenticateMcpBearerToken, parseBearerToken } from '@/lib/agent-auth';
import { ApiError, type ApiContext } from '@/lib/api/operations';
import { checkRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

// REST transport for the shared operation layer. Same API keys + scopes as the
// MCP gateway (Bearer token → mcp_api_keys), same rate-limit bucket. Errors come
// back as { error: { code, message } } with the operation's HTTP status.

type Operation = (ctx: ApiContext, input: Record<string, unknown>) => Promise<unknown>;

function jsonError(status: number, code: string, message: string, extraHeaders?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: extraHeaders });
}

// Coerce query-string values into the JSON-ish shapes operations expect
// ('true'/'false' → boolean, numeric strings → number, else string).
export function coerceQuery(searchParams: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of searchParams.entries()) {
    // Only booleans are coerced. Numeric-looking IDs must stay strings — the
    // operations read string params with `typeof === 'string'` guards, so an
    // id like "123" coerced to a number would be silently dropped. The few
    // genuine number params (limit, afterId) coerce defensively on their own.
    if (value === 'true') out[key] = true;
    else if (value === 'false') out[key] = false;
    else out[key] = value;
  }
  return out;
}

// Authenticate, rate-limit, run the operation, format the result/error.
export async function runRestOperation(
  request: Request,
  op: Operation,
  input: Record<string, unknown>
): Promise<NextResponse> {
  const token = parseBearerToken(request.headers.get('authorization'));
  if (!token) return jsonError(401, 'unauthorized', 'Missing Bearer token');

  const principal = await authenticateMcpBearerToken(token);
  if (!principal) return jsonError(401, 'unauthorized', 'Invalid API key');
  if (!principal.workspaceId) return jsonError(403, 'no_workspace', 'API key has no workspace');

  const rl = await checkRateLimit('mcp', principal.keyId);
  if (!rl.allowed) {
    return jsonError(429, 'rate_limited', `Retry after ${rl.retryAfterSeconds}s`, {
      'Retry-After': String(rl.retryAfterSeconds)
    });
  }

  const ctx: ApiContext = {
    admin: createAdminClient(),
    ownerId: principal.ownerId,
    workspaceId: principal.workspaceId,
    scopes: principal.scopes
  };

  try {
    const result = await op(ctx, input);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonError(error.status, error.code, error.code);
    }
    return jsonError(500, 'internal_error', 'Internal error');
  }
}
