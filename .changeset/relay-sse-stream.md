---
"@glyph-oss/connect": minor
---

Add relay-backed SSE transport for dApps without a server.

- `subscribeViaRelay(nonce, options?)` opens a streaming fetch to the Glyph relay and returns a `Promise<GlyphCallbackResponse>`. Works in browsers, Node 18+, Bun, Deno, and service workers. No `EventSource` dependency.
- `relayCallbackUrl(nonce, relayUrl?)` builds the callback URL for `createEnvelope()`.
- Supports `onStatus` progress callbacks: `opening_wallet`, `awaiting_approval`, `completed`, `failed`.
