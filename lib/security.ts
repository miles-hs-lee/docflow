import crypto from 'node:crypto';

import bcrypt from 'bcryptjs';

import type { ViewerGrantPayload } from '@/lib/types';

export function generateShareToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateMcpApiKey() {
  return `df_mcp_${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashMcpApiKey(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function getMcpKeyPrefix(value: string) {
  return value.slice(0, 18);
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// Pragmatic RFC-lite shape check for viewer-submitted emails. The gate form
// has type="email", but the server action is independently invocable — and a
// garbage "email" flows into contacts, the visitor identity rollup, and the
// on-page watermark label, so the server must validate its own input.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailShape(email: string) {
  return email.length <= 254 && EMAIL_SHAPE.test(email);
}

export function getEmailDomain(email: string) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex < 1 || atIndex === normalized.length - 1) return null;
  return normalized.slice(atIndex + 1);
}

export function parseAllowedDomains(input: string) {
  return input
    .split(',')
    .map((value) => value.trim().toLowerCase().replace(/^@/, ''))
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}

// Storage-safe object name: collapse anything outside [A-Za-z0-9._-] to '_'.
// Shared by every upload path (owner PDF, MCP, file-request inbound) so the
// sanitization rule can't drift across endpoints.
export function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function hashIp(ip: string | null | undefined) {
  if (!ip) return null;
  // HMAC with a server-side salt — IPv4 has only ~4G addresses, so an
  // unsalted SHA-256 is trivial to reverse with a precomputed table.
  // Falls back to VIEWER_COOKIE_SECRET if a dedicated IP_HASH_SALT is unset
  // (kept as one secret in dev; deploys should set both independently).
  const salt = process.env.IP_HASH_SALT || process.env.VIEWER_COOKIE_SECRET;
  if (!salt) {
    throw new Error('Missing IP_HASH_SALT (or VIEWER_COOKIE_SECRET fallback) for IP hashing.');
  }
  return crypto.createHmac('sha256', salt).update(ip).digest('hex');
}

export function timingSafeEqualString(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function signWebhookPayload(body: string, secret: string, timestamp: string) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// Viewer session helpers live in lib/viewer-session.ts so the edge-runtime
// middleware can import them without pulling node:crypto. Re-exported here
// to keep the existing import paths working across server-only callers.
export { createViewerSessionId, isUuid, normalizeViewerSessionId } from '@/lib/viewer-session';

export function signViewerGrant(payload: ViewerGrantPayload, secret: string) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyViewerGrant(value: string, secret: string): ViewerGrantPayload | null {
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;

  const expectedSignature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (signature.length !== expectedSignature.length) {
    return null;
  }

  const validSignature = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!validSignature) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed?.linkId || !parsed?.grantedAt) return null;
    return parsed as ViewerGrantPayload;
  } catch {
    return null;
  }
}
