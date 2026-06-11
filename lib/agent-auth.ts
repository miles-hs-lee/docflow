import { createAdminClient } from '@/lib/supabase/admin';
import { hashMcpApiKey } from '@/lib/security';

export const MCP_SCOPES = [
  'files:read',
  'files:write',
  'links:read',
  'links:write',
  'analytics:read',
  'automations:read',
  'automations:write'
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_DEFAULT_SCOPES: McpScope[] = [...MCP_SCOPES];

export type McpPrincipal = {
  keyId: string;
  ownerId: string;
  workspaceId: string | null;
  scopes: string[];
  label: string;
};

export function normalizeMcpScopes(scopes: unknown): McpScope[] {
  if (!Array.isArray(scopes)) return [];
  return scopes.filter((scope): scope is McpScope => typeof scope === 'string' && MCP_SCOPES.includes(scope as McpScope));
}

export function parseBearerToken(authorization: string | null | undefined) {
  if (!authorization) return null;
  const [type, token] = authorization.trim().split(/\s+/, 2);
  if (!type || !token) return null;
  if (type.toLowerCase() !== 'bearer') return null;
  return token;
}

// last_used_at powers the dashboard's "마지막 사용" column — minute-level
// precision is plenty, so skip the write when the stamp is fresh instead of
// adding one UPDATE to every API call.
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export async function authenticateMcpBearerToken(rawToken: string): Promise<McpPrincipal | null> {
  const tokenHash = hashMcpApiKey(rawToken);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('mcp_api_keys')
    .select('id, owner_id, workspace_id, scopes, label, last_used_at')
    .eq('key_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const lastUsedAt = data.last_used_at ? new Date(data.last_used_at).getTime() : 0;
  if (!Number.isFinite(lastUsedAt) || Date.now() - lastUsedAt > LAST_USED_WRITE_INTERVAL_MS) {
    await admin
      .from('mcp_api_keys')
      .update({
        last_used_at: new Date().toISOString()
      })
      .eq('id', data.id);
  }

  return {
    keyId: data.id,
    ownerId: data.owner_id,
    workspaceId: data.workspace_id,
    scopes: (data.scopes ?? []) as string[],
    label: data.label
  };
}

export function ensureScope(principal: McpPrincipal, required: McpScope) {
  if (!principal.scopes.includes(required)) {
    throw new Error(`missing_scope:${required}`);
  }
}
