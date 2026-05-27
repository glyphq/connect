import { describe, expect, test } from "bun:test";
import {
  buildSigilUrl,
  createConnectRequest,
  createEnvelope,
  createTransferRequest,
  hashSignedRequestPayload,
  isAllowedCallbackUrl,
  parseCallbackResponse,
  signEnvelope,
  verifyEnvelopeSignature,
} from "./index";

describe("@sigil-oss/connect", () => {
  test("builds a Sigil URL with an envelope payload", () => {
    const request = createTransferRequest({
      type: "transfer",
      dapp: { name: "Demo", origin: "https://demo.app" },
      to: "UVYAOYTNYCRBVFBHNFIJUEOUEPEDIDUWWEAXKFSJEBJVASCQEROJOVOEEATL",
      amount: "1000",
    });

    const url = buildSigilUrl(
      createEnvelope(request, { callback: "https://demo.app/callback" }),
      { includeLegacyCallbackParam: true },
    );

    expect(url.startsWith("sigil://v1/request?d=")).toBe(true);
    expect(url.includes("&cb=https%3A%2F%2Fdemo.app%2Fcallback")).toBe(true);
  });

  test("allows only https and localhost http callbacks", () => {
    expect(isAllowedCallbackUrl("https://demo.app/cb")).toBe(true);
    expect(isAllowedCallbackUrl("http://localhost:3000/cb")).toBe(true);
    expect(isAllowedCallbackUrl("http://127.0.0.1:3000/cb")).toBe(true);
    expect(isAllowedCallbackUrl("http://demo.app/cb")).toBe(false);
  });

  test("signs an envelope with ES256 proof metadata", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const envelope = createEnvelope(
      createConnectRequest({
        type: "connect",
        dapp: { name: "Demo", origin: "https://demo.app" },
        permissions: ["transfer"],
      }),
      { callback: "https://demo.app/callback" },
    );

    const signed = await signEnvelope(envelope, {
      issuer: "demo.app",
      privateJwk,
      publicJwk,
      includePublicJwk: true,
    });

    expect(signed.proof?.algorithm).toBe("ES256");
    expect(signed.proof?.issuer).toBe("demo.app");
    expect(signed.proof?.signature.length).toBeGreaterThan(16);
    expect(signed.proof?.payload_hash).toBe(await hashSignedRequestPayload(envelope));
  });

  // ── verifyEnvelopeSignature ────────────────────────────────────────────────

  test("verifyEnvelopeSignature returns true for a valid signed envelope", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const envelope = createEnvelope(
      createConnectRequest({
        type: "connect",
        dapp: { name: "Demo", origin: "https://demo.app" },
      }),
      { callback: "https://demo.app/callback" },
    );

    const signed = await signEnvelope(envelope, {
      issuer: "demo.app",
      privateJwk,
      includePublicJwk: true,
      publicJwk,
    });

    expect(await verifyEnvelopeSignature(signed)).toBe(true);
  });

  test("verifyEnvelopeSignature returns false for proof-less envelope", async () => {
    const envelope = createEnvelope(
      createConnectRequest({
        type: "connect",
        dapp: { name: "Demo", origin: "https://demo.app" },
      }),
    );
    expect(await verifyEnvelopeSignature(envelope)).toBe(false);
  });

  test("verifyEnvelopeSignature rejects tampered envelope", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const envelope = createEnvelope(
      createConnectRequest({
        type: "connect",
        dapp: { name: "Demo", origin: "https://demo.app" },
        permissions: ["transfer"],
      }),
      { callback: "https://demo.app/callback" },
    );

    const signed = await signEnvelope(envelope, {
      issuer: "demo.app",
      privateJwk,
      includePublicJwk: true,
      publicJwk,
    });

    // Tamper the request after signing
    const tampered = {
      ...signed,
      request: { ...signed.request, dapp: { ...signed.request.dapp, name: "Evil App" } },
    };

    expect(await verifyEnvelopeSignature(tampered)).toBe(false);
  });

  test("verifyEnvelopeSignature accepts external publicJwk override", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const envelope = createEnvelope(
      createConnectRequest({
        type: "connect",
        dapp: { name: "Demo", origin: "https://demo.app" },
      }),
    );

    // Sign without embedding public key in proof
    const signed = await signEnvelope(envelope, { issuer: "demo.app", privateJwk });

    expect(await verifyEnvelopeSignature(signed, { publicJwk })).toBe(true);
  });

  // ── parseCallbackResponse ─────────────────────────────────────────────────

  test("parses a signed transfer callback", () => {
    const result = parseCallbackResponse({
      status: "signed",
      type: "transfer",
      nonce: "abc123",
      identity: "AAAA",
      tx_hash: "DEADBEEF",
      target_tick: 100,
    });
    expect(result.status).toBe("signed");
    if (result.status === "signed" && (result.type === "transfer" || result.type === "sc_call")) {
      expect(result.tx_hash).toBe("DEADBEEF");
      expect(result.target_tick).toBe(100);
    }
  });

  test("parses a signed message callback", () => {
    const result = parseCallbackResponse({
      status: "signed",
      type: "sign_message",
      nonce: "abc123",
      identity: "AAAA",
      signature: "sig",
      public_key: "pk",
    });
    expect(result.status).toBe("signed");
    if (result.status === "signed" && result.type === "sign_message") {
      expect(result.signature).toBe("sig");
    }
  });

  test("parses a connected callback", () => {
    const result = parseCallbackResponse({
      status: "connected",
      type: "connect",
      nonce: "abc123",
      identity: "AAAA",
      permissions: ["transfer"],
    });
    expect(result.status).toBe("connected");
    if (result.status === "connected") {
      expect(result.permissions).toEqual(["transfer"]);
    }
  });

  test("parses a verified callback", () => {
    const result = parseCallbackResponse({
      status: "verified",
      type: "verify_message",
      nonce: "abc123",
      valid: true,
      identity: "AAAA",
    });
    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.valid).toBe(true);
    }
  });

  test("parses a rejected callback", () => {
    const result = parseCallbackResponse({
      status: "rejected",
      type: "transfer",
      nonce: "abc123",
      reason: "user_rejected",
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toBe("user_rejected");
    }
  });

  test("parseCallbackResponse throws on unknown status/type", () => {
    expect(() =>
      parseCallbackResponse({ status: "unknown", type: "transfer", nonce: "x" }),
    ).toThrow();
  });

  test("parseCallbackResponse throws on non-object input", () => {
    expect(() => parseCallbackResponse(null)).toThrow();
    expect(() => parseCallbackResponse("string")).toThrow();
    expect(() => parseCallbackResponse(42)).toThrow();
  });
});
