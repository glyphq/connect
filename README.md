<div align="center">

# `@glyph-oss/connect`

**TypeScript SDK for Glyph deep-link requests**

[![npm](https://img.shields.io/npm/v/@glyph-oss/connect?style=flat-square&color=0d0d0d&labelColor=1a1a1a)](https://www.npmjs.com/package/@glyph-oss/connect)
[![License](https://img.shields.io/badge/license-MIT-0d0d0d?style=flat-square&labelColor=1a1a1a)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/glyphq/connect/ci.yml?style=flat-square&label=build&color=0d0d0d&labelColor=1a1a1a)](https://github.com/glyphq/connect/actions)

Framework-agnostic · Zero runtime dependencies · Fully typed

</div>

---

Build and dispatch `glyph://` requests to the [Glyph desktop wallet](https://github.com/glyphq/wallet) from any web app, dApp, or toolchain. Learn more at [glyphq.org](https://glyphq.org).

## Install

```bash
bun add @glyph-oss/connect
# or
npm install @glyph-oss/connect
```

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

// Build the deep-link URL.
const url = buildGlyphUrl(envelope);

// Or launch directly in a browser.
import { launchGlyphRequest } from "@glyph-oss/connect";
launchGlyphRequest(envelope);
```

## Request Types

| Builder | Description |
|---|---|
| `createTransferRequest()` | Sign a QU transfer to a recipient |
| `createScCallRequest()` | Sign a smart contract input |
| `createSignMessageRequest()` | Sign a message for off-chain auth |
| `createVerifyMessageRequest()` | Verify an existing signature bundle |
| `createConnectRequest()` | Request a wallet session with permissions |

All builders require an HTTPS `dapp.origin`, then generate a nonce and expiry by default.

## Envelope Model

Requests are wrapped in an envelope before encoding into the deep-link URL:

```ts
interface GlyphEnvelope {
  request: GlyphRequest;       // discriminated union on "type"
  callback?: string | null;    // optional server delivery URL
  redirect_uri?: string | null; // optional browser result URL
}
```

```ts
const envelope = createEnvelope(request, { callback: "https://my.app/api/callback" });
const url = buildGlyphUrl(envelope);
```

Deep links target `glyph://v1/request?d=<base64url envelope>`.

## Result Delivery

Glyph delivers results to your app via one or both modes:

| Mode | How it works |
|---|---|
| `callback` | Glyph POSTs a JSON result to your server after the user acts |
| `redirect_uri` | Glyph opens `redirect_uri?result=<base64url>` in the browser |
| relay | dApp streams the result via the [Glyph relay](https://github.com/glyphq/relay) (no server needed) |

Parse the callback body on your server:

```ts
import { parseCallbackResponse } from "@glyph-oss/connect";

const result = parseCallbackResponse(await req.json());

switch (result.status) {
  case "signed":
    if (result.type === "transfer" || result.type === "sc_call") {
      console.log(result.tx_hash, result.target_tick);
    }
    break;
  case "connected":
    console.log(result.identity, result.permissions);
    break;
  case "rejected":
    console.log(result.reason); // "user_rejected"
    break;
}
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
      if (status.state === "awaiting_approval") {
        showMessage("Continue in Glyph Wallet");
      }
    },
  },
);

// On your /__glyph__ route:
handleRedirect({
  closeDelayMs: 1200,
  onResult() {
    showMessage("Request completed. Returning to the application.");
  },
});
```

`glyphRequest()` opens Glyph, reports transport-level progress, waits on `BroadcastChannel`, and resolves when the callback route broadcasts the `result` query parameter. The originating page attempts to regain focus when the browser permits it.

## Relay Stream (no server required)

When your dApp has no backend, use the [Glyph relay](https://github.com/glyphq/relay) to receive results via SSE. The relay is a Cloudflare Worker with Durable Objects that bridges the wallet's callback POST to a streaming response.

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
  createNonce,
} from "@glyph-oss/connect";

const nonce = createNonce();
const request = createTransferRequest({
  type: "transfer",
  dapp: { name: "My App", origin: "https://my.app" },
  to: "UVYAOYTNYCRBVFBHNFIJUEOUEPEDIDUWWEAXKFSJEBJVASCQEROJOVOEEATL",
  amount: "1000",
});

// Point the callback to the relay
const envelope = createEnvelope(request, {
  callback: relayCallbackUrl(nonce),
});

// Connect to the relay stream, then launch
const resultPromise = subscribeViaRelay(nonce, {
  onStatus(status) {
    if (status.state === "awaiting_approval") {
      showMessage("Continue in Glyph Wallet");
    }
  },
});

launchGlyphRequest(envelope);

const result = await resultPromise;
```

`subscribeViaRelay()` uses `fetch` with streaming (no `EventSource` dependency), so it works in browsers, Node 18+, Bun, Deno, and service workers.

## API Reference

**URL and envelope**
`createEnvelope` · `encodeEnvelope` · `buildGlyphUrl` · `openGlyphUrl` · `launchGlyphRequest` · `glyphRequest` · `handleRedirect`

**Request builders**
`createTransferRequest` · `createScCallRequest` · `createSignMessageRequest` · `createVerifyMessageRequest` · `createConnectRequest`

**Relay client**
`subscribeViaRelay` · `relayCallbackUrl`

**Utilities**
`createNonce` · `createExpiry` · `withRequestDefaults` · `isAllowedCallbackUrl` · `base64UrlToString` · `parseCallbackResponse`

## Constraints

- `dapp.origin` must be `https://`.
- Callback URLs must be `https://`, except `http://localhost`, `http://127.0.0.1`, and `http://[::1]`.
- `launchGlyphRequest` and `glyphRequest` require a browser environment with `window`.
- `subscribeViaRelay` uses `fetch` and works in any modern runtime (browsers, Node 18+, Bun, Deno, service workers).
- Deep links target `glyph://v1/request?d=...`.

## Development

```bash
bun install
bun run check
bun run audit
```

## License

MIT
