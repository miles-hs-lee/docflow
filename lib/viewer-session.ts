// Edge-safe viewer session id helpers. lib/security.ts pulls in node:crypto
// for HMAC / hashing, which the middleware (edge runtime) cannot import; this
// module only relies on globalThis.crypto so it works in both runtimes.

// Mirrored from lib/viewer-cookie.ts so the edge middleware can read the
// cookie name without dragging the node-crypto sign/verify path along.
export const VIEWER_SESSION_COOKIE = 'docflow_vid';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function createViewerSessionId(): string {
  return globalThis.crypto.randomUUID();
}

export function normalizeViewerSessionId(value: string | null | undefined): string {
  if (value && UUID_RE.test(value)) return value;
  return createViewerSessionId();
}
