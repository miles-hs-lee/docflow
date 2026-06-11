import crypto from 'node:crypto';

import { getViewerCookieSecret } from '@/lib/env-server';

// Owner preview mode: a short-lived, HMAC-signed token that lets a workspace
// member open their own link AS A VIEWER without consuming policy state or
// polluting analytics. Without it, an owner testing a link burns claim_view
// slots (a one_time link dies on its owner's first test), inflates opens /
// uniques / dwell, and has to pass their own email/password/NDA gates.
//
// Issued only by the authed dashboard route (/dashboard/links/[id]/preview),
// scoped to one link, expires in 15 minutes. The signature input is domain-
// separated from the grant cookie ("preview." prefix) so neither token can be
// replayed as the other even though both use VIEWER_COOKIE_SECRET.
const PREVIEW_TTL_MS = 15 * 60 * 1000;

type PreviewPayload = {
  l: string; // link id
  e: number; // expiry epoch ms
};

function signEncoded(encoded: string) {
  return crypto
    .createHmac('sha256', getViewerCookieSecret())
    .update(`preview.${encoded}`)
    .digest('base64url');
}

export function createLinkPreviewToken(linkId: string): string {
  const payload: PreviewPayload = { l: linkId, e: Date.now() + PREVIEW_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signEncoded(encoded)}`;
}

export function verifyLinkPreviewToken(raw: string | null | undefined, linkId: string): boolean {
  if (!raw) return false;
  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature) return false;

  const expected = signEncoded(encoded);
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<PreviewPayload>;
    return payload?.l === linkId && typeof payload?.e === 'number' && payload.e > Date.now();
  } catch {
    return false;
  }
}
