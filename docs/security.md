# Security posture

This document tracks dependency vulnerabilities that we are aware of but
have intentionally not patched, with the rationale. Reviewed alongside
each release; entries should either be removed (fixed upstream) or have
their risk re-evaluated.

## Dependency advisories — currently clean

As of the most recent commit, `npm audit --omit=dev` reports **0 vulnerabilities**.

The earlier `picomatch` (high) and `postcss` (moderate) advisories that
shipped inside `next` / `tailwind` / `eslint` subtrees are now patched
through `npm overrides` in [`package.json`](../package.json):

```jsonc
"overrides": {
  "postcss": "$postcss",      // pin every transitive postcss to our direct dep (8.5.14+, > advisory threshold)
  "picomatch": "^4.0.3"        // bump nested picomatch instances past the ReDoS / POSIX-class advisories
}
```

`$postcss` tells npm to reuse the version of our top-level `postcss`
dependency (`devDependencies.postcss`) for every transitive copy —
including the one Next bundles internally. `picomatch ^4.0.3` is bumped
in absolute terms because no top-level dep exists for it.

### Re-audit cadence

Run `npm audit --omit=dev` on every release branch and after any
`npm install` that adds a new dep. If a new advisory appears under a
package these overrides did not cover (e.g. `lodash`, `cross-spawn`),
extend the overrides block or, if the package is a direct dep, bump
the direct version. Document any advisory we *do* accept (rare) here
with the rationale.

### Override compatibility risk

`postcss` 8.5.14 is API-compatible with the 8.4.x line Next normally
ships, but a future Next major bump that depends on a new postcss
feature could break under this override. The build runs as part of CI,
so a regression would be caught immediately. If that happens, drop the
override for `postcss` and document the residual advisory here while
waiting on the next Next release.

## Other security guarantees

The runtime application enforces:

- **HMAC-signed viewer grant cookies** with `policy_version` fingerprint —
  any policy change on a `share_links` row invalidates outstanding grants.
- **Atomic `claim_view` RPC** with `(link_id, session_id)` dedup — collection
  viewers consume one slot per session, not one per file.
- **`SECURITY DEFINER` RPCs** are explicitly REVOKE'd from PUBLIC / anon /
  authenticated where they are not meant to be called by browser sessions
  (migration 008).
- **Webhook URLs** rejected at registration if HTTPS-less or resolving to
  private / loopback / link-local / metadata IPs (`lib/url-safety.ts`),
  and re-validated at dispatch time as a DNS rebinding defense.
- **Upload contents** validated by both MIME and `%PDF-` magic byte
  (`/dashboard/upload`, `/api/mcp`).
- **IP addresses** stored as `HMAC-SHA256` keyed on `IP_HASH_SALT` (or
  `VIEWER_COOKIE_SECRET` fallback) — unsalted SHA-256 over IPv4 is
  trivially reversible.

## Not yet enforced

- Rate limiting on viewer routes / webhook ingest. Currently no per-IP
  or per-token throttling.
- Content Security Policy headers.
- Static security review of the PDF.js pipeline served to viewers.
