# @sigil-oss/connect

## 1.0.0

### Major Changes

- 15faeb7: Remove proof/signing system and add async `sigilRequest()` API

  **Breaking:** `SigilProof`, `SigilProofOptions`, `signEnvelope`, `verifyEnvelopeSignature`, `serializeSignedRequestPayload`, `hashSignedRequestPayload` are all removed. The `proof` field is gone from `SigilEnvelope`.

  **New:** `sigilRequest(req, options?)` — launches Sigil via a link click and returns a `Promise<SigilCallbackResponse>` backed by `BroadcastChannel`. No server, no polling.

  **New:** `handleRedirect()` — call at your `callbackPath` route (default `/__sigil__`); reads `?result=`, broadcasts to the waiting Promise, closes the tab.

  **New:** `redirect_uri` field on `SigilEnvelope` and `createEnvelope` options — Sigil opens the browser to this URL with the result as a `?result=` query param after the user acts.

## 0.3.0

### Minor Changes

- de27362: Add callback response parsing, signature verification, and browser launch fix

  - `parseCallbackResponse(body)` — parse and type-narrow the five Sigil callback response shapes (signed transfer, signed message, connected, verified, rejected); throws on unknown or malformed payloads
  - `verifyEnvelopeSignature(envelope, options?)` — verify an ES256 signed envelope using the embedded `public_jwk` or a caller-supplied key; returns `false` for proof-less envelopes
  - Fix `openSigilUrl` to use an anchor-click instead of `window.location.assign`, which allows the `sigil://` protocol handler to be triggered without navigating the current page
  - Export new callback response types: `SigilSignedTransferCallback`, `SigilSignedMessageCallback`, `SigilConnectedCallback`, `SigilVerifiedCallback`, `SigilRejectedCallback`, `SigilCallbackResponse`

## 0.2.0

### Minor Changes

- 2ee6687: Initial release scaffold for the Sigil Connect SDK, including typed deep-link request builders, envelope signing helpers, tests, and Changesets-based publish automation.

All notable changes to this package will be documented in this file.

The format is based on Changesets and follows semver.
