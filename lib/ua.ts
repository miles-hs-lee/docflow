// User-agent heuristics for analytics ingest.
//
// Link-preview unfurlers (Slack / Teams / iMessage), mail-security scanners
// (Outlook SafeLinks and friends) and generic crawlers fetch /v/* URLs the
// moment a link is pasted somewhere. Without filtering they inflate
// open_count ("보냈더니 조회수 3") and, on gated links, pile up phantom
// 'denied' events. Spoofing a bot UA gains an attacker nothing here: bots
// are only ever EXCLUDED from analytics writes and denied document bytes —
// policy enforcement itself never trusts this check.

const BOT_UA_PATTERN = new RegExp(
  [
    // generic crawler vocabulary
    'bot', 'crawler', 'spider', 'crawling', 'prerender', 'scrapy',
    // link unfurlers / preview fetchers
    'facebookexternalhit', 'slackbot', 'skypeuripreview', 'telegrambot',
    'whatsapp', 'discordbot', 'linkedinbot', 'twitterbot', 'bingpreview',
    'preview',
    // mail-security / monitoring scanners
    'safelinks', 'urldefense', 'scan', 'monitor(ing)?\\b', 'probe',
    // scripted clients
    'curl', 'wget', 'python-requests', 'python/', 'httpclient', 'okhttp',
    'go-http-client', 'java/', 'libwww', 'headless'
  ].join('|'),
  'i'
);

export function isLikelyBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return BOT_UA_PATTERN.test(userAgent);
}

// Coarse device class for the visitor table. Derived from the user_agent we
// already store on every event — display-only, no new collection.
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';

export function classifyDevice(userAgent: string | null | undefined): DeviceClass | null {
  if (!userAgent) return null;
  // iPadOS 13+ masquerades as macOS Safari; "Macintosh" + touch support is
  // indistinguishable server-side, so those iPads classify as desktop.
  if (/ipad|tablet|android(?!.*mobile)/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

// Normalize a platform geo header (e.g. x-vercel-ip-country) to an ISO
// 3166-1 alpha-2 code, else null. Never derived from the raw IP ourselves.
export function normalizeCountryCode(value: string | null | undefined): string | null {
  const code = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}
