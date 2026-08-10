<div align="center">

# `@glyph-oss/connect`

**TypeScript SDK for Glyph deep-link requests**

[![npm](https://img.shields.io/npm/v/@glyph-oss/connect?style=flat-square&color=0d0d0d&labelColor=1a1a1a)](https://www.npmjs.com/package/@glyph-oss/connect)
[![License](https://img.shields.io/badge/license-MIT-0d0d0d?style=flat-square&labelColor=1a1a1a)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/glyphq/connect/ci.yml?style=flat-square&label=build&color=0d0d0d&labelColor=1a1a1a)](https://github.com/glyphq/connect/actions)

Framework-agnostic · Zero runtime dependencies · Fully typed

</div>

---

Build and dispatch `glyph://` requests to the [Glyph desktop wallet](https://github.com/glyphq/wallet) from web apps, dApps, and JavaScript toolchains. Learn more at [glyphq.org](https://glyphq.org).

## Install

```bash
bun add @glyph-oss/connect
# or
npm install @glyph-oss/connect
```

The package is published as Node-compatible ESM and supports Node 18+ for non-browser helpers. Browser launch helpers require `window`.

## Quick Start

```ts
import { createTransferRequest, createEnvelope, buildGlyphUrl } from "@glyph-oss/connect";

const request = createTransferRequest({
  type: "transfer",
  dapp: { name: "My App", origin: "https://my.app" },
  to: "UVYAOYTNYCRBVFBHNFIJUEOUEPEDIDUWWEAXKFSJEBJVASCQEROJOVOEEATL",
  amount: "1000",
});

const envelope = createEnvelope(request, {
  callback: "https://my.app/api/glyph/callback",
});

const url = buildGlyphUrl(envelope);
```

## Request Types

| Builder | Description |
|---|---|
| `createTransferRequest()` | Sign a QU transfer to a recipient |
| `createScCallRequest()` | Sign a smart contract input |
| `createSignMessageRequest()` | Sign a message for off-chain auth |
| `createVerifyMessageRequest()` | Verify an existing signature bundle |
| `createConnectRequest()` | Request a wallet session with permissions |

Builders generate a 16 to 128 character nonce and five minute expiry by default. Expiry is capped at one hour to match the wallet replay window.

## Envelope Model

Requests are wrapped in an envelope before encoding into the deep-link URL:

```ts
interface GlyphEnvelope {
  request: GlyphRequest;
  callback?: string | null;
  redirect_uri?: string | null;
}
```

```ts
const envelope = createEnvelope(request, { callback: "https://my.app/api/callback" });
const url = buildGlyphUrl(envelope);
```

Deep links target `glyph://v1/request?d=<base64url envelope>`. Encoded payloads are bounded to the wallet's 8192 byte base64url limit.

## Result Delivery

Glyph delivers results to your app via one of these modes:

| Mode | How it works |
|---|---|
| `callback` | Glyph POSTs a JSON result to your server after the user acts |
| `redirect_uri` | Glyph opens `redirect_uri?result=<base64url>` in the browser |
| relay | dApp streams the result from the official Glyph relay via SSE |

Validate server callback bodies against the expected request nonce and type:

```ts
import { parseCallbackResponse } from "@glyph-oss/connect";

const result = parseCallbackResponse(await req.json(), {
  nonce: request.nonce,
  type: request.type,
});
```

## Browser Promise Flow

Use `glyphRequest()` when you want a single promise instead of wiring your own callback handler.

```ts
import { createConnectRequest, glyphRequest, handleRedirect } from "@glyph-oss/connect";

const result = await glyphRequest(
  createConnectRequest({
    type: "connect",
    dapp: { name: "My App", origin: "https://my.app" },
    permissions: ["transfer", "sign_message"],
  }),
  {
    onStatus(status) {
      if (status.state === "awaiting_approval") showMessage("Continue in Glyph Wallet");
    },
  },
);

// On your /__glyph__ route:
handleRedirect();
```

`glyphRequest()` opens Glyph, waits on `BroadcastChannel`, and accepts a broadcast only when the result matches the request nonce and type.

## Relay Stream (no server required)

When your dApp has no backend, use the official Glyph relay at `https://relay.glyphq.org` to receive results via SSE.

```
dApp ──── glyph:// deep link ──────→ wallet (Tauri)
dApp ←── SSE /v1/stream/:nonce ──── relay ←── POST /v1/callback/:nonce ── wallet
```

```ts
import {
  createTransferRequest,
  createEnvelope,
  launchGlyphRequest,
  subscribeViaRelay,
  relayCallbackUrl,
} from "@glyph-oss/connect";

const request = createTransferRequest({
  type: "transfer",
  dapp: { name: "My App", origin: "https://my.app" },
  to: "UVYAOYTNYCRBVFBHNFIJUEOUEPEDIDUWWEAXKFSJEBJVASCQEROJOVOEEATL",
  amount: "1000",
});

// Bind the relay callback path and SSE stream to the same request nonce.
const resultPromise = subscribeViaRelay(request, {
  onStatus(status) {
    if (status.state === "awaiting_approval") showMessage("Continue in Glyph Wallet");
  },
});
const envelope = createEnvelope(request, { callback: relayCallbackUrl(request.nonce) });

launchGlyphRequest(envelope);
const result = await resultPromise;
```

`subscribeViaRelay()` uses streaming `fetch` and a standards-compliant SSE parser, including CRLF and multi-line `data:` fields. Custom relay origins are rejected because the wallet only treats the official relay callback as a trusted cross-origin delivery URL.

## Compatibility and Security Policy

The SDK mirrors wallet `deep_link.rs` policy:

- `dapp.origin` must be a credential-free canonical HTTPS origin with no path, query, or fragment.
- Delivery URLs must use HTTPS, must not embed credentials, and must not target localhost, private, reserved, multicast, documentation, or otherwise non-global IP literals.
- `callback` and `redirect_uri` must match `dapp.origin`.
- The only cross-origin `callback` exception is `https://relay.glyphq.org/v1/callback/:nonce` with a bounded relay nonce. `redirect_uri` has no relay exception.
- Relay callback and stream nonce path segments must be 16 to 128 characters using only `A-Z`, `a-z`, `0-9`, `-`, and `_`.
- Callback and relay results are rejected when the result nonce or request type does not match the expected request.

## API Reference

**URL and envelope**
`createEnvelope` · `encodeEnvelope` · `buildGlyphUrl` · `openGlyphUrl` · `launchGlyphRequest` · `glyphRequest` · `handleRedirect`

**Request builders**
`createTransferRequest` · `createScCallRequest` · `createSignMessageRequest` · `createVerifyMessageRequest` · `createConnectRequest`

**Relay client**
`subscribeViaRelay` · `relayCallbackUrl`

**Utilities**
`createNonce` · `createExpiry` · `withRequestDefaults` · `validateGlyphRequest` · `canonicalDappOrigin` · `isAllowedCallbackUrl` · `isAllowedDeliveryUrl` · `isOfficialRelayCallbackUrl` · `base64UrlToString` · `parseCallbackResponse`

## Development

```bash
bun install
bun run check
bun run audit
bun run smoke:node-import
```

## License

MIT
