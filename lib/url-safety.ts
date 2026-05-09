import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Webhook URL hardening.
 *
 * Caller-supplied URLs (automation subscriptions) are fetched server-side. If
 * the host resolves to a private / link-local / cloud-metadata IP, we end up
 * making requests to internal infrastructure (EC2 IMDS at 169.254.169.254,
 * Supabase internal IPs, your own database, etc.) — classic SSRF.
 *
 * `assertSafePublicUrl(url)` enforces:
 *   - https:// only
 *   - host resolves to a public, non-loopback, non-private, non-link-local IP
 *   - no userinfo (https://user:pass@host) since some libraries leak it
 *
 * `safeFetchTimeoutMs` caps the request duration. DNS rebinding is partially
 * defended by re-resolving inside this function — the actual fetch still
 * does its own DNS, so a determined attacker can flip the answer between
 * our check and the fetch. For higher assurance, callers should pin the
 * resolved IP and set the Host header manually; we accept the residual risk.
 */

const PRIVATE_V4_RANGES: Array<[number, number, number]> = [
  [0x0a000000, 0xff000000, 0x00000000], // 10.0.0.0/8
  [0xac100000, 0xfff00000, 0x00000000], // 172.16.0.0/12
  [0xc0a80000, 0xffff0000, 0x00000000], // 192.168.0.0/16
  [0x7f000000, 0xff000000, 0x00000000], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xffff0000, 0x00000000], // 169.254.0.0/16 (link-local + cloud metadata)
  [0x64400000, 0xffc00000, 0x00000000], // 100.64.0.0/10 (CGNAT)
  [0x00000000, 0xff000000, 0x00000000] // 0.0.0.0/8
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const x = Number(p);
    if (!Number.isInteger(x) || x < 0 || x > 255) return null;
    n = (n << 8) | x;
  }
  return n >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return PRIVATE_V4_RANGES.some(([base, mask]) => (n & mask) === (base & mask));
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback, unspecified, link-local, unique-local
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fe80:') || // link-local
    lower.startsWith('fc') || // unique-local fc00::/7
    lower.startsWith('fd') ||
    lower.startsWith('::ffff:') // IPv4-mapped — fall back to v4 check
  );
}

function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) {
    if (ip.toLowerCase().startsWith('::ffff:')) {
      const v4 = ip.slice(7);
      return isPrivateV4(v4);
    }
    return isPrivateV6(ip);
  }
  // Unknown — fail closed.
  return true;
}

export async function assertSafePublicUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('웹훅 URL 형식이 올바르지 않습니다.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('웹훅 URL은 HTTPS만 허용됩니다.');
  }

  if (url.username || url.password) {
    throw new Error('URL에 자격 증명을 포함할 수 없습니다.');
  }

  // If the host is already a literal IP, check it directly.
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) {
      throw new Error('웹훅 URL이 사설 / 내부 IP를 가리킵니다.');
    }
    return url;
  }

  let resolved;
  try {
    resolved = await lookup(url.hostname, { all: true });
  } catch {
    throw new Error('웹훅 호스트를 해석할 수 없습니다.');
  }

  for (const entry of resolved) {
    if (isPrivateAddress(entry.address)) {
      throw new Error('웹훅 호스트가 사설 / 내부 IP로 해석됩니다.');
    }
  }

  return url;
}

export const SAFE_FETCH_TIMEOUT_MS = 5000;
