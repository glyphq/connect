# @glyph-oss/connect

## 2.1.0

### Minor Changes

- 38d2d91: Add request lifecycle feedback, focus restoration, and configurable callback completion handling.

## 2.0.0

### Major Changes

- 2507c01: Rebrand the SDK for Glyph, publish under the `@glyph-oss` npm scope, switch canonical deep links to `glyph://`, and remove the old pre-adoption protocol/API names instead of keeping compatibility aliases.

## 1.0.0

### Major Changes

- 15faeb7: Remove proof/signing system and add async `glyphRequest()` API

  **Breaking:** proof types, envelope signing helpers, signed payload serialization helpers, and the `proof` field are removed from `GlyphEnvelope`.

  **New:** `glyphRequest(req, options?)` launches Glyph via a link click and returns a `Promise<GlyphCallbackResponse>` backed by `BroadcastChannel`. No server and no polling are required for the browser promise flow.

  **New:** `handleRedirect()` reads `?result=` at the callback route, broadcasts to the waiting Promise, and closes the tab. The default callback route is `/__glyph__`.

  **New:** `redirect_uri` on `GlyphEnvelope` and `createEnvelope` options lets Glyph open the browser with `?result=` after the user acts.

## 0.3.0

### Minor Changes

- de27362: Add callback response parsing and browser launch fixes

  - `parseCallbackResponse(body)` parses and type-narrows the five Glyph callback response shapes: signed transfer, signed message, connected, verified, and rejected.
  - Browser launch uses an anchor click so the `glyph://` protocol handler can be triggered without navigating the current page.
  - Export callback response types: `GlyphSignedTransferCallback`, `GlyphSignedMessageCallback`, `GlyphConnectedCallback`, `GlyphVerifiedCallback`, `GlyphRejectedCallback`, `GlyphCallbackResponse`.

## 0.2.0

### Minor Changes

- 2ee6687: Initial release scaffold for the Glyph Connect SDK, including typed deep-link request builders, envelope helpers, tests, and Changesets-based publish automation.

All notable changes to this package will be documented in this file.

The format is based on Changesets and follows semver.
