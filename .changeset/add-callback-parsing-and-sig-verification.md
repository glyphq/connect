---
"@sigil-oss/connect": minor
---

Add callback response parsing, signature verification, and browser launch fix

- `parseCallbackResponse(body)` — parse and type-narrow the five Sigil callback response shapes (signed transfer, signed message, connected, verified, rejected); throws on unknown or malformed payloads
- `verifyEnvelopeSignature(envelope, options?)` — verify an ES256 signed envelope using the embedded `public_jwk` or a caller-supplied key; returns `false` for proof-less envelopes
- Fix `openSigilUrl` to use an anchor-click instead of `window.location.assign`, which allows the `sigil://` protocol handler to be triggered without navigating the current page
- Export new callback response types: `SigilSignedTransferCallback`, `SigilSignedMessageCallback`, `SigilConnectedCallback`, `SigilVerifiedCallback`, `SigilRejectedCallback`, `SigilCallbackResponse`
