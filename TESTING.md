# `@sigil-oss/connect` Testing Guide

Release checklist for the Sigil Connect SDK.

This package is small, but it sits directly on the wallet handoff boundary. Treat request-format drift and callback-policy regressions as release blockers.

---

## Required Checks

Run before every release:

```bash
bun install
bun run check
```

This covers:

- TypeScript typecheck
- unit tests
- production build output

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
- `buildSigilUrl()` produces `sigil://v1/request?d=...`
- legacy callback query param is only included when requested

### Browser launch helper

Verify:

- `launchSigilRequest()` returns the final URL
- browser-only helper throws cleanly in a non-browser environment

### Signed request helpers

Verify:

- `serializeSignedRequestPayload()` is stable
- `hashSignedRequestPayload()` is deterministic
- `signEnvelope()` emits `proof.algorithm = "ES256"`
- signed proof includes `payload_hash`
- optional `public_jwk` inclusion works

---

## Cross-Compatibility Pass

Before publishing, validate one generated URL against a current installed Sigil build.

At minimum:

1. Generate a `transfer` request URL with this package.
2. Open it against Sigil.
3. Confirm Sigil shows the request review screen.
4. Repeat for `connect` and `sign_message`.

If Sigil rejects the payload, do not ship until the package and wallet are back in sync.

---

## Regression Risks To Watch

Treat these as high risk:

- wallet request-envelope shape changes
- callback policy changes
- signed proof serialization drift
- request type field renames
- accidental Node-only or browser-only runtime assumptions in shared helpers

---

## Release Exit Criteria

Do not publish if any of these fail:

- package fails `bun run check`
- built `dist/` output is missing JS or `.d.ts`
- generated deep links no longer open current Sigil builds
- non-HTTPS origin validation regresses
- callback URL policy regresses
- signing helper output becomes incompatible with Sigil trust verification
