# `@glyph-oss/connect` Testing Guide

Release checklist for the Glyph Connect SDK.

This package sits directly on the wallet handoff boundary. Treat request-format drift, result-validation drift, package import regressions, and callback-policy regressions as release blockers.

---

## Required Checks

Run before every release:

```bash
bun install --frozen-lockfile
bun run check
bun run audit
bun run smoke:node-import
```

This covers:

- TypeScript typecheck
- unit tests
- production build output
- high-severity dependency audit
- `npm pack`, install of the packed tarball into a clean temporary project, and Node ESM import of the published entrypoint

---

## Core Scenarios

### Request builders

Verify all request helpers produce the expected shape:

- `createTransferRequest`
- `createScCallRequest`
- `createSignMessageRequest`
- `createVerifyMessageRequest`
- `createConnectRequest`

Checks:

- `nonce` is generated when omitted and is 16 to 128 characters
- `exp` is generated when omitted, rejects expired values, and is capped to the wallet one hour replay window
- custom `nonce` and `exp` are preserved only when wallet-compatible
- `dapp.origin` is canonical HTTPS, credential-free, and has no path, query, or fragment
- localhost, private, reserved, multicast, documentation, and otherwise non-global IP literals are rejected where the SDK can identify them locally
- transfer, smart-contract, sign-message, verify-message, and permissions semantic bounds match wallet validation

### Envelope helpers

Verify:

- `createEnvelope()` accepts same-origin HTTPS callback and redirect URLs
- `callback` allows exactly the official relay callback route as the cross-origin exception
- `redirect_uri` does not allow the relay exception
- invalid credentials, non-global literals, non-HTTPS schemes, and cross-origin delivery URLs throw
- `encodeEnvelope()` returns a base64url payload and enforces the 8192 byte encoded payload limit
- `buildGlyphUrl()` produces `glyph://v2/request?d=...` with `protocol: "glyph-connect-request/2"`, a mainnet default network binding, and a validated `request_hash`.
- callback URLs stay inside the encoded envelope instead of being duplicated as query params

### Browser launch helper

Verify:

- `launchGlyphRequest()` returns the final URL
- `glyphRequest()` rejects cleanly in a non-browser environment
- `handleRedirect()` broadcasts parsed callback results on the expected `glyph:result:<nonce>` channel
- `glyphRequest()` validates the received result against the expected nonce and request type before resolving

### Callback parser

Verify:

- accepted statuses are narrowed to the expected discriminated union
- malformed base64url values throw before parsing
- unknown request types throw
- unknown permissions throw
- rejection reasons are limited to `user_rejected`
- expected nonce mismatches throw
- expected request type mismatches throw

### Relay client

Verify:

- secure relay v2 sessions split callback and read capabilities and register before streaming
- secure relay v2 stream subscriptions target only the prepared session read-capability URL
- subscribing by nonce string requires `expectedType`, or callers pass the request object directly
- relay results are parsed and then checked against the expected nonce and request type
- malformed JSON, malformed callback bodies, mismatched nonce, and mismatched type reject
- the SSE parser accepts LF, CRLF, comments, and multi-line `data:` fields

---

## Cross-Compatibility Pass

Before publishing, validate generated URLs against a current installed Glyph build.

At minimum:

1. Generate a `transfer` request URL with this package.
2. Open it against Glyph.
3. Confirm Glyph shows the request review screen.
4. Repeat for `connect`, `sign_message`, `verify_message`, and `sc_call` where possible.
5. Generate a relay-backed callback with `prepareRelaySession()` and confirm the wallet accepts only the secure v2 callback capability route.

If Glyph rejects the payload, do not ship until the package and wallet are back in sync.

---

## Regression Risks To Watch

Treat these as high risk:

- wallet request-envelope shape changes
- wallet `deep_link.rs` dApp origin, delivery URL, nonce, expiry, payload, or request semantic policy changes
- callback and relay result validation drift
- request type field renames
- accidental Node-only or browser-only runtime assumptions in shared helpers
- published-package ESM import regressions
- old protocol or package references reappearing in public API or docs

---

## Release Exit Criteria

Do not publish if any of these fail:

- package fails `bun run check`
- `bun audit --audit-level=high` reports a vulnerability
- packed tarball cannot be installed and imported by Node ESM
- built `dist/` output is missing JS or `.d.ts`
- generated deep links no longer open current Glyph builds
- origin, delivery URL, nonce, expiry, payload, request semantic, or result validation policy regresses
- `git grep -i` finds old package names or protocols in source, docs, or metadata
