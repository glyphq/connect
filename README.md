<div align="center">

# `@sigil-oss/connect`

**TypeScript SDK for Sigil deep-link requests**

[![npm](https://img.shields.io/npm/v/@sigil-oss/connect?style=flat-square&color=0d0d0d&labelColor=1a1a1a)](https://www.npmjs.com/package/@sigil-oss/connect)
[![License](https://img.shields.io/badge/license-MIT-0d0d0d?style=flat-square&labelColor=1a1a1a)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/sigil-oss/sigil.connect/release.yml?style=flat-square&label=build&color=0d0d0d&labelColor=1a1a1a)](https://github.com/sigil-oss/sigil.connect/actions)

Framework-agnostic · Zero runtime dependencies · Fully typed

</div>

---

Build, sign, and dispatch `sigil://` requests to the [Sigil desktop wallet](https://github.com/sigil-oss/sigil.app) from any web app, dApp, or toolchain — no React, Vue, or framework runtime required.

## Install

```bash
bun add @sigil-oss/connect
# or
npm install @sigil-oss/connect
```

## Quick Start

```ts
import { createTransferRequest, createEnvelope, buildSigilUrl } from "@sigil-oss/connect";

const request = createTransferRequest({
  dapp: { name: "My App", origin: "https://my.app" },
  to: "SIGILZXQNLOTDENBWIBTOGRNBPLBWISKLZCQQFMEECEKOTNVJMMGRWYALYQL",
  amount: "1000",
});

const envelope = createEnvelope(request, {
  callback: "https://my.app/api/sigil/callback",
});

// Build the deep-link URL
const url = buildSigilUrl(envelope);

// Or launch directly in a browser
import { launchSigilRequest } from "@sigil-oss/connect";
launchSigilRequest(envelope);
```

## Request Types

| Builder | Description |
|---|---|
| `createTransferRequest()` | Sign a QU transfer to a recipient |
| `createScCallRequest()` | Sign a smart contract input |
| `createSignMessageRequest()` | Sign a message for off-chain auth |
| `createVerifyMessageRequest()` | Verify an existing signature bundle |
| `createConnectRequest()` | Request a wallet session with permissions |

All builders require an HTTPS `dapp.origin`, and generate a nonce and expiry by default.

## Envelope Model

Requests are wrapped in an envelope before encoding into the deep-link URL:

```ts
interface SigilEnvelope {
  request: SigilRequest;       // discriminated union on "type"
  callback?: string | null;    // server POST delivery
  proof?: SigilProof;          // optional signed trust proof
}
```

```ts
const envelope = createEnvelope(request, { callback: "https://my.app/api/callback" });
const url = buildSigilUrl(envelope);
```

## Result Delivery

Sigil delivers results to your app via one or both modes:

| Mode | How it works |
|---|---|
| `callback` | Sigil POSTs a JSON result to your server after the user acts |
| `redirect_uri` | Sigil opens `redirect_uri?result=<base64url>` in the browser |

Parse the callback body on your server:

```ts
import { parseCallbackResponse } from "@sigil-oss/connect";

const result = parseCallbackResponse(await req.json());

switch (result.status) {
  case "signed":
    console.log(result.tx_hash, result.target_tick);
    break;
  case "connected":
    console.log(result.identity, result.permissions);
    break;
  case "rejected":
    console.log(result.reason); // "user_rejected"
    break;
}
```

## Signed Requests

Attach an ES256 proof for trusted dApp flows:

```ts
import { createConnectRequest, createEnvelope, signEnvelope } from "@sigil-oss/connect";

const request = createConnectRequest({
  dapp: { name: "Trusted App", origin: "https://trusted.app" },
  permissions: ["transfer", "sign_message"],
});

const signed = await signEnvelope(createEnvelope(request), {
  issuer: "trusted.app",
  privateJwk,
  publicJwk,
  includePublicJwk: true,
});
```

Verify a received envelope:

```ts
import { verifyEnvelopeSignature } from "@sigil-oss/connect";

const valid = await verifyEnvelopeSignature(signed);
```

## API Reference

**URL & envelope**
`createEnvelope` · `encodeEnvelope` · `buildSigilUrl` · `openSigilUrl` · `launchSigilRequest`

**Request builders**
`createTransferRequest` · `createScCallRequest` · `createSignMessageRequest` · `createVerifyMessageRequest` · `createConnectRequest`

**Signing & verification**
`signEnvelope` · `verifyEnvelopeSignature` · `serializeSignedRequestPayload` · `hashSignedRequestPayload`

**Utilities**
`createNonce` · `createExpiry` · `withRequestDefaults` · `isAllowedCallbackUrl` · `parseCallbackResponse`

## Constraints

- `dapp.origin` must be `https://`
- Callback URLs must be `https://`, except `http://localhost` and `http://127.0.0.1`
- `launchSigilRequest` requires a browser environment (`window`)
- Deep links target `sigil://v1/request?d=...`

## Development

```bash
bun install
bun run check   # lint + types + tests
```

## License

MIT
