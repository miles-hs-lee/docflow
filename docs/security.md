# Security posture

This document tracks dependency vulnerabilities that we are aware of but
have intentionally not patched, with the rationale. Reviewed alongside
each release; entries should either be removed (fixed upstream) or have
their risk re-evaluated.

## Known dependency advisories (as of 2026-05)

`npm audit --omit=dev` reports three transitive vulnerabilities at the
time of writing. None are exploitable in the running application; they
exist in build-time tooling that ships inside `next`'s subtree. The
audit checker treats them as runtime because they live under `node_modules/next`,
even though they execute only during `next build`.

| Advisory | Package | Severity | Path | Status |
|---|---|---|---|---|
| GHSA-3v7f-55p6-f55p | picomatch (POSIX class injection) | high | `node_modules/picomatch`, `node_modules/tinyglobby/node_modules/picomatch` | Build-time glob matcher used by tailwind/eslint. No untrusted glob inputs in the build pipeline. |
| GHSA-c2c7-rcm5-vvqj | picomatch (extglob ReDoS) | high | same as above | Same build-time pathway. CI build is single-tenant and bounded. |
| GHSA-qx2v-qp2m-jg93 | postcss `<8.5.10` (XSS via unescaped `</style>` in stringify) | moderate | `node_modules/next/node_modules/postcss` | Used by Next at build time to assemble the CSS bundle from our own source. We do not stringify untrusted CSS. |

### Why we are not patching them today

- **picomatch**: only reachable through `tailwindcss` and `eslint` build
  steps. We control the input globs (defined in `tailwind.config.ts` /
  `eslint.config.mjs`); no user-supplied data crosses the matcher.
- **postcss**: `next` pins its own `postcss` version. `npm audit fix --force`
  would downgrade `next` to `9.3.3`, which has its own pre-15.x security
  advisories and lacks every App Router / RSC primitive the app relies on.

### When to revisit

- A new `next` minor (15.6+) that bumps the embedded `postcss`.
- `tailwindcss` / `eslint` minors that drop `picomatch`.
- Any report that the picomatch ReDoS or postcss XSS is reachable from
  *runtime* (not build-time) inputs in a Next App Router project.

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
