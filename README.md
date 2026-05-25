# `@sigil-oss/connect`

Framework-agnostic TypeScript SDK for launching Sigil deep-link requests.

`@sigil-oss/connect` gives web apps, desktop apps, and hybrid frontends a small typed layer for interacting with the Sigil wallet without depending on React, Vue, Svelte, or any framework runtime.

Use it to:

- build valid `sigil://` request URLs
- create typed `transfer`, `connect`, `sign_message`, `verify_message`, and `sc_call` requests
- attach callback URLs safely
- generate signed request proofs for trusted Sigil flows

---

## Install

```bash
bun add @sigil-oss/connect
```

or

```bash
npm install @sigil-oss/connect
```

---

## Why This Package Exists

Sigil itself is a desktop wallet.

This package is the companion SDK for dApps and tools that want to hand requests off to Sigil in a predictable, typed, cross-framework way. It keeps request construction in sync with the wallet’s current deep-link model, including:

- request envelopes
- callback handling
- nonce / expiry defaults
- optional signed proof metadata

---

## Quick Start

```ts
import {
  createTransferRequest,
  createEnvelope,
  buildSigilUrl,
} from "@sigil-oss/connect";

const request = createTransferRequest({
  type: "transfer",
  dapp: {
    name: "Demo App",
    origin: "https://demo.app",
  },
  to: "UVYAOYTNYCRBVFBHNFIJUEOUEPEDIDUWWEAXKFSJEBJVASCQEROJOVOEEATL",
  amount: "1000",
});

const envelope = createEnvelope(request, {
  callback: "https://demo.app/api/sigil/callback",
});

const url = buildSigilUrl(envelope);
```

You can then:

- assign `url` to a button or anchor
- call `window.location.assign(url)`
- use `launchSigilRequest(envelope)` in browser environments

---

## Request Builders

The package exposes typed helpers for the current Sigil request model:

- `createTransferRequest()`
- `createScCallRequest()`
- `createSignMessageRequest()`
- `createVerifyMessageRequest()`
- `createConnectRequest()`

All builders:

- require an HTTPS `dapp.origin`
- generate a nonce by default
- generate a short-lived expiry by default

You can override nonce or expiry when needed.

---

## Envelope Model

Sigil now accepts request envelopes, not only flat request payloads.

```ts
interface SigilEnvelope {
  request: SigilRequest;
  callback?: string | null;
  proof?: SigilProof;
}
```

Build one with:

```ts
const envelope = createEnvelope(request, {
  callback: "https://demo.app/api/callback",
});
```

Then encode it into a deep link:

```ts
const url = buildSigilUrl(envelope);
```

If you need compatibility with older callback query handling, you can include the legacy `cb` parameter too:

```ts
const url = buildSigilUrl(envelope, {
  includeLegacyCallbackParam: true,
});
```

---

## Signed Requests

If your integration uses Sigil’s signed trust flow, you can attach an ES256 proof:

```ts
import {
  createConnectRequest,
  createEnvelope,
  signEnvelope,
} from "@sigil-oss/connect";

const request = createConnectRequest({
  type: "connect",
  dapp: {
    name: "Trusted Demo",
    origin: "https://demo.app",
  },
  permissions: ["transfer", "sign_message"],
});

const envelope = createEnvelope(request, {
  callback: "https://demo.app/api/callback",
});

const signed = await signEnvelope(envelope, {
  issuer: "demo.app",
  privateJwk,
  publicJwk,
  includePublicJwk: true,
});
```

Related helpers:

- `serializeSignedRequestPayload()`
- `hashSignedRequestPayload()`
- `signEnvelope()`

---

## Browser Helper

To launch Sigil directly from a browser context:

```ts
import { launchSigilRequest } from "@sigil-oss/connect";

launchSigilRequest(envelope);
```

This helper throws when used outside a browser environment.

---

## API Surface

### URL and request helpers

- `createNonce()`
- `createExpiry()`
- `withRequestDefaults()`
- `createEnvelope()`
- `encodeEnvelope()`
- `buildSigilUrl()`
- `openSigilUrl()`
- `launchSigilRequest()`

### Validation helpers

- `isAllowedCallbackUrl()`

### Signing helpers

- `serializeSignedRequestPayload()`
- `hashSignedRequestPayload()`
- `signEnvelope()`

### Types

- `SigilRequest`
- `SigilEnvelope`
- `SigilProof`
- `SigilPermission`
- `SigilTransferRequest`
- `SigilScCallRequest`
- `SigilSignMessageRequest`
- `SigilVerifyMessageRequest`
- `SigilConnectRequest`

---

## Compatibility Notes

- `dapp.origin` must use `https://`
- callback URLs must use `https://`, except `http://localhost` and `http://127.0.0.1`
- the generated deep links target Sigil’s current `sigil://v1/request?d=...` format
- this package is framework-agnostic, but browser-launch helpers require `window`

---

## Local Development

```bash
bun install
bun run check
```

---

## Release Flow

This package uses Changesets.

- add a changeset for each user-facing package change
- merge to `main`
- let the GitHub release workflow open or update the release PR
- publish through the Changesets action with `NPM_TOKEN`

---

## License

MIT
