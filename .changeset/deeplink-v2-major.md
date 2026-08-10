---
"@glyph-oss/connect": major
---

Implement the breaking Glyph Connect request deep-link v2 contract.

- Switch request URLs to `glyph://v2/request` with `glyph-connect-request/2` envelopes.
- Add deterministic JCS/RFC8785-compatible canonical JSON and `sha256:<base64url>` request/network hashing.
- Bind requests and signed callback envelopes to typed Qubic networks, defaulting safely to mainnet.
- Remove v1 request launch compatibility from documented and tested SDK behavior.
