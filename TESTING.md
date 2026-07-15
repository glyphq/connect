# `@glyph-oss/connect` Testing Guide

Release checklist for the Glyph Connect SDK.

This package sits directly on the wallet handoff boundary. Treat request-format drift and callback-policy regressions as release blockers.

---

## Required Checks

Run before every release:

```bash
bun install --frozen-lockfile
bun run check
bun run audit
```

This covers:

- TypeScript typecheck
- unit tests
- production build output
- dependency audit for high-severity advisories

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

- `nonce` is generated when omitted
- `exp` is generated when omitted
- custom `nonce` and `exp` are preserved when provided
- `dapp.origin` rejects non-HTTPS values

### Envelope helpers

Verify:

- `createEnvelope()` accepts valid callback URLs
- invalid callback URLs throw
- `encodeEnvelope()` returns a base64url payload
- `buildGlyphUrl()` produces `glyph://v1/request?d=...`
- callback URLs stay inside the encoded envelope instead of being duplicated as query params

### Browser launch helper

Verify:

- `launchGlyphRequest()` returns the final URL
- `glyphRequest()` rejects cleanly in a non-browser environment
- `handleRedirect()` broadcasts parsed callback results on the expected `glyph:result:<nonce>` channel

### Callback parser

Verify:

- accepted statuses are narrowed to the expected discriminated union
- malformed base64url values throw before parsing
- unknown request types throw
- unknown permissions throw
- rejection reasons are limited to `user_rejected`

---

## Cross-Compatibility Pass

Before publishing, validate one generated URL against a current installed Glyph build.

At minimum:

1. Generate a `transfer` request URL with this package.
2. Open it against Glyph.
3. Confirm Glyph shows the request review screen.
4. Repeat for `connect` and `sign_message`.

If Glyph rejects the payload, do not ship until the package and wallet are back in sync.

---

## Regression Risks To Watch

Treat these as high risk:

- wallet request-envelope shape changes
- callback policy changes
- request type field renames
- accidental Node-only or browser-only runtime assumptions in shared helpers
- old protocol or package references reappearing in public API or docs

---

## Release Exit Criteria

Do not publish if any of these fail:

- package fails `bun run check`
- built `dist/` output is missing JS or `.d.ts`
- generated deep links no longer open current Glyph builds
- non-HTTPS origin validation regresses
- callback URL policy regresses
- `git grep -i` finds old package names or protocols in source, docs, or metadata
