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
import { createTransferRequest, createEnvelope, buildGlyphUrl, GLYPH_MAINNET } from "@glyph-oss/connect";

const request = createTransferRequest({
  type: "transfer",
  dapp: { name: "My App", origin: "https://my.app" },
  to: "UVYAOYTNYCRBVFBHNFIJUEOUEPEDIDUWWEAXKFSJEBJVASCQEROJOVOEEATL",
  amount: "1000",
});

const envelope = createEnvelope(request, {
  callback: "https://my.app/api/glyph/callback",
  network: GLYPH_MAINNET, // default when omitted
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
  protocol: "glyph-connect-request/2";
  request: GlyphRequest;
  callback?: string | null;
  redirect_uri?: string | null;
  network: { id: "qubic:mainnet" | "qubic:testnet" | `qubic:custom:sha256:${string}` };
  request_hash: `sha256:${string}`;
}
```

```ts
const envelope = createEnvelope(request, { callback: "https://my.app/api/callback" });
const url = buildGlyphUrl(envelope);
```

Deep links target `glyph://v2/request?d=<base64url envelope>`. The SDK has no v1 request launch compatibility. `request_hash` is computed over the RFC8785/JCS canonical UTF-8 JSON of `{ protocol, request, callback, redirect_uri, network }`, excluding `request_hash`. Encoded payloads are bounded to the wallet's 8192 byte base64url limit.

Mainnet is the safe default. Use `GLYPH_TESTNET` for testnet or `createCustomNetworkBinding(rpcObject)` for a custom RPC binding. The custom network id is `qubic:custom:sha256:<JCS hash of rpcObject>`.

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

For the secure callback protocol, accept the wallet's `glyph-connect-callback-envelope/2` body and verify its Qubic SchnorrQ proof before trusting the decoded result. V2 callbacks are bound to the original `request_hash` and `network`:

```ts
import { verifyCallbackEnvelope } from "@glyph-oss/connect";

const result = await verifyCallbackEnvelope(await req.json(), {
  expected: { nonce: request.nonce, type: request.type },
  expectedDappOrigin: request.dapp.origin,
  expectedRequestHash: envelope.request_hash,
  expectedNetwork: envelope.network,
  expectedExp: request.exp ?? null,
  expectedCallbackUrl: callbackUrl,
  requireSigned: true,
  trustedPublicKeys: [walletCallbackPublicKey],
  verifySignature(input) {
    // The SDK performs strict envelope, canonical payload, hash, nonce, and type checks.
    // Inject a Qubic SchnorrQ verifier for the final cryptographic signature check.
    return verifySchnorrQ(input.payload, input.signature, input.publicKey);
  },
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

## Secure relay capabilities

The next relay protocol splits write and read authority. Use a callback capability only in the wallet callback URL, and keep the read capability only in your dApp process:

```ts
import {
	prepareRelaySession,
	subscribeViaRelayV2,
	createEnvelope,
	launchGlyphRequest,
} from "@glyph-oss/connect";

// Registers session, c_ callback capability, and r_ read capability at /v2/register/:session.
const relay = await prepareRelaySession();
const envelope = createEnvelope(request, { callback: relay.callbackUrl });
const resultPromise = subscribeViaRelayV2(request, relay, {
	requestHash: envelope.request_hash,
	maxPollAttempts: 3,
	verification: { requireSigned: true, verifySignature: verifySchnorrQ },
	onEvent(event) {
		console.info(event.milestone, event.supportId, event.snapshot);
	},
});

launchGlyphRequest(envelope);
const result = await resultPromise;
```

`prepareRelaySession()` POSTs `{ callbackCap, readCap }` to `/v2/register/:session` before launch. `relay.callbackUrl` is `POST /v2/callback/:session/:callbackCap`, where `callbackCap` starts with `c_`. `relay.streamUrl` and `relay.resultUrl` use a separate `r_` read capability. The SDK enforces distinct, high-entropy base64url capabilities and never exposes the read capability to the wallet.

Relay subscriptions retain the existing `onStatus` states and can additionally receive capability-free lifecycle events with `onEvent`. Stream timeouts and transient interruptions use a bounded `/v2/result` recovery window before failing. Recovered callbacks go through the same strict callback parser or signed-envelope verifier as SSE results. Use `requestHash` to include a deterministic local `supportId` in diagnostics. The support ID is never added to a Glyph envelope, URL, or signed payload, and no automatic same-nonce relaunch is performed.

## Compatibility and Security Policy

The SDK mirrors wallet `deep_link.rs` policy:

- `dapp.origin` must be a credential-free canonical HTTPS origin with no path, query, or fragment.
- Delivery URLs must use HTTPS, must not embed credentials, and must not target localhost, private, reserved, multicast, documentation, or otherwise non-global IP literals.
- `callback` and `redirect_uri` must match `dapp.origin`.
- The only cross-origin `callback` exception is a secure relay v2 callback URL: `https://relay.glyphq.org/v2/callback/:session/:callbackCap`, with `callbackCap` prefixed by `c_`. `redirect_uri` has no relay exception.
- Read URLs use a separate `r_` read capability and are not valid delivery URLs.
- Callback and relay results are rejected when the result nonce or request type does not match the expected request.
- Signed callback envelopes should be verified with `verifyCallbackEnvelope()` and a trusted wallet callback verification key. The SDK performs strict parser and binding checks, then calls your injected Qubic SchnorrQ verifier for the cryptographic signature check.

## API Reference

**URL and envelope**
`createEnvelope` · `encodeEnvelope` · `buildGlyphUrl` · `openGlyphUrl` · `launchGlyphRequest` · `glyphRequest` · `handleRedirect`

**Request builders**
`createTransferRequest` · `createScCallRequest` · `createSignMessageRequest` · `createVerifyMessageRequest` · `createConnectRequest`

**Relay client**
`subscribeViaRelayV2` · `createRelayCapabilities` · `relayUrls` · `registerRelaySession` · `prepareRelaySession` · `GlyphRelayError` · `deriveGlyphSupportId`

**Utilities**
`createNonce` · `createExpiry` · `withRequestDefaults` · `validateGlyphRequest` · `canonicalDappOrigin` · `isAllowedCallbackUrl` · `isAllowedDeliveryUrl` · `isOfficialRelayCallbackUrl` · `base64UrlToString` · `base64UrlToByteArray` · `parseCallbackResponse` · `verifyCallbackEnvelope` · `isSignedCallbackEnvelope`

## Development

```bash
bun install
bun run check
bun run audit
bun run smoke:node-import
```

## License

MIT
