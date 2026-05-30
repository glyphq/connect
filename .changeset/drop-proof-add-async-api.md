---
"@sigil-oss/connect": major
---

Remove proof/signing system and add async `sigilRequest()` API

**Breaking:** `SigilProof`, `SigilProofOptions`, `signEnvelope`, `verifyEnvelopeSignature`, `serializeSignedRequestPayload`, `hashSignedRequestPayload` are all removed. The `proof` field is gone from `SigilEnvelope`.

**New:** `sigilRequest(req, options?)` — launches Sigil via a link click and returns a `Promise<SigilCallbackResponse>` backed by `BroadcastChannel`. No server, no polling.

**New:** `handleRedirect()` — call at your `callbackPath` route (default `/__sigil__`); reads `?result=`, broadcasts to the waiting Promise, closes the tab.

**New:** `redirect_uri` field on `SigilEnvelope` and `createEnvelope` options — Sigil opens the browser to this URL with the result as a `?result=` query param after the user acts.
