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

export function hashIp(ip: string | null | undefined) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex');
}

export function timingSafeEqualString(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function signWebhookPayload(body: string, secret: string, timestamp: string) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function createViewerSessionId() {
  return crypto.randomUUID();
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeViewerSessionId(value: string | null | undefined) {
  if (!value || !isUuid(value)) {
    return createViewerSessionId();
  }

  return value;
}

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
