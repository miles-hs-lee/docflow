// Connectivity/auth smoke test for Upstash QStash.
//   node scripts/check-qstash.mjs
// Load .env.local first: `set -a && source .env.local && set +a`.
// Publishes ONE message to a harmless sink (consumes 1 of the free 500/day)
// and reports the messageId, or the QStash error verbatim.

import { Client } from '@upstash/qstash';

const token = process.env.QSTASH_TOKEN;
if (!token) {
  console.error('✗ Missing QSTASH_TOKEN in the environment.');
  process.exit(1);
}

const client = new Client({ token });

try {
  const res = await client.publishJSON({
    url: 'https://httpbin.org/status/200',
    body: { test: 'docflow-qstash-smoke' },
    retries: 0
  });
  console.log('✓ QStash publish accepted — messageId:', res.messageId);
} catch (err) {
  console.error('✗ QStash publish failed:', err?.message ?? err);
  process.exit(1);
}
