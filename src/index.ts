export type SigilPermission = "transfer" | "sc_call" | "sign_message";
export type SigilRequestType =
  | "transfer"
  | "sc_call"
  | "sign_message"
  | "verify_message"
  | "connect";

export interface SigilDappMeta {
  name?: string;
  origin: string;
  icon?: string;
}

export interface SigilBaseRequest {
  type: SigilRequestType;
  dapp: SigilDappMeta;
  nonce: string;
  exp?: number;
}

export interface SigilTransferRequest extends SigilBaseRequest {
  type: "transfer";
  to: string;
  amount: string | number;
  from?: string;
  tick_offset?: number;
}

export interface SigilScCallRequest extends SigilBaseRequest {
  type: "sc_call";
  contract_index: number;
  input_type: number;
  from?: string;
  amount?: string | number;
  payload?: string;
  tick_offset?: number;
}

export interface SigilSignMessageRequest extends SigilBaseRequest {
  type: "sign_message";
  message: string;
  from?: string;
  data?: string;
}

export interface SigilVerifyMessageRequest extends SigilBaseRequest {
  type: "verify_message";
  message: string;
  data?: string;
  signature: string;
  public_key: string;
}

export interface SigilConnectRequest extends SigilBaseRequest {
  type: "connect";
  permissions?: SigilPermission[];
}

export type SigilRequest =
  | SigilTransferRequest
  | SigilScCallRequest
  | SigilSignMessageRequest
  | SigilVerifyMessageRequest
  | SigilConnectRequest;

export interface SigilProof {
  version: 1;
  algorithm: "ES256";
  issuer: string;
  key_id?: string;
  payload_hash: string;
  signature: string;
  public_jwk?: JsonWebKey;
}

export interface SigilEnvelope {
  request: SigilRequest;
  callback?: string | null;
  proof?: SigilProof;
}

// ── Callback response types ────────────────────────────────────────────────────

export interface SigilSignedTransferCallback {
  status: "signed";
  type: "transfer" | "sc_call";
  nonce: string;
  identity: string;
  tx_hash: string;
  target_tick: number;
}

export interface SigilSignedMessageCallback {
  status: "signed";
  type: "sign_message";
  nonce: string;
  identity: string;
  signature: string;
  public_key: string;
}

export interface SigilConnectedCallback {
  status: "connected";
  type: "connect";
  nonce: string;
  identity: string;
  permissions: SigilPermission[];
}

export interface SigilVerifiedCallback {
  status: "verified";
  type: "verify_message";
  nonce: string;
  valid: boolean;
  identity: string;
}

export interface SigilRejectedCallback {
  status: "rejected";
  type: SigilRequestType;
  nonce: string;
  reason: "user_rejected";
}

export type SigilCallbackResponse =
  | SigilSignedTransferCallback
  | SigilSignedMessageCallback
  | SigilConnectedCallback
  | SigilVerifiedCallback
  | SigilRejectedCallback;

export interface SigilUrlOptions {
  includeLegacyCallbackParam?: boolean;
}

export interface SigilRequestDefaults {
  nonce?: string;
  exp?: number;
  ttlSeconds?: number;
}

export interface SigilProofOptions {
  issuer: string;
  keyId?: string;
  privateJwk: JsonWebKey;
  includePublicJwk?: boolean;
  publicJwk?: JsonWebKey;
}

const DEFAULT_EXPIRY_SECONDS = 300;

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function assertValidDappOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("dApp origin must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("dApp origin must use HTTPS");
  }
}

export function isAllowedCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1";
    return url.protocol === "https:" || (url.protocol === "http:" && isLocal);
  } catch {
    return false;
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function createNonce(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

export function createExpiry(ttlSeconds = DEFAULT_EXPIRY_SECONDS): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("ttlSeconds must be a positive number");
  }
  return unixNow() + Math.floor(ttlSeconds);
}

export function withRequestDefaults<T extends Omit<SigilRequest, "nonce" | "exp">>(
  request: T,
  defaults: SigilRequestDefaults = {},
): T & Pick<SigilBaseRequest, "nonce" | "exp"> {
  assertValidDappOrigin(request.dapp.origin);
  return {
    ...request,
    nonce: defaults.nonce ?? createNonce(),
    exp: defaults.exp ?? createExpiry(defaults.ttlSeconds),
  };
}

export function createTransferRequest(
  request: Omit<SigilTransferRequest, "nonce" | "exp">,
  defaults?: SigilRequestDefaults,
): SigilTransferRequest {
  return withRequestDefaults(request, defaults);
}

export function createScCallRequest(
  request: Omit<SigilScCallRequest, "nonce" | "exp">,
  defaults?: SigilRequestDefaults,
): SigilScCallRequest {
  return withRequestDefaults(request, defaults);
}

export function createSignMessageRequest(
  request: Omit<SigilSignMessageRequest, "nonce" | "exp">,
  defaults?: SigilRequestDefaults,
): SigilSignMessageRequest {
  return withRequestDefaults(request, defaults);
}

export function createVerifyMessageRequest(
  request: Omit<SigilVerifyMessageRequest, "nonce" | "exp">,
  defaults?: SigilRequestDefaults,
): SigilVerifyMessageRequest {
  return withRequestDefaults(request, defaults);
}

export function createConnectRequest(
  request: Omit<SigilConnectRequest, "nonce" | "exp">,
  defaults?: SigilRequestDefaults,
): SigilConnectRequest {
  return withRequestDefaults(request, defaults);
}

export function createEnvelope(
  request: SigilRequest,
  options: { callback?: string | null; proof?: SigilProof } = {},
): SigilEnvelope {
  if (options.callback && !isAllowedCallbackUrl(options.callback)) {
    throw new Error("Callback URL must use HTTPS or localhost HTTP");
  }
  return {
    request,
    callback: options.callback ?? null,
    proof: options.proof,
  };
}

export function encodeEnvelope(envelope: SigilEnvelope): string {
  if (envelope.callback && !isAllowedCallbackUrl(envelope.callback)) {
    throw new Error("Callback URL must use HTTPS or localhost HTTP");
  }
  return stringToBase64Url(JSON.stringify(envelope));
}

export function buildSigilUrl(envelope: SigilEnvelope, options: SigilUrlOptions = {}): string {
  const payload = encodeEnvelope(envelope);
  const params = new URLSearchParams({ d: payload });

  if (options.includeLegacyCallbackParam && envelope.callback) {
    params.set("cb", envelope.callback);
  }

  return `sigil://v1/request?${params.toString()}`;
}

export function openSigilUrl(url: string): void {
  if (typeof window === "undefined") {
    throw new Error("openSigilUrl can only be used in a browser environment");
  }
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function launchSigilRequest(envelope: SigilEnvelope, options?: SigilUrlOptions): string {
  const url = buildSigilUrl(envelope, options);
  openSigilUrl(url);
  return url;
}

export function serializeSignedRequestPayload(
  envelope: Pick<SigilEnvelope, "request" | "callback">,
): string {
  return canonicalize({
    request: envelope.request,
    callback: envelope.callback ?? null,
  });
}

export async function hashSignedRequestPayload(
  envelope: Pick<SigilEnvelope, "request" | "callback">,
): Promise<string> {
  const payload = serializeSignedRequestPayload(envelope);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function signEnvelope(
  envelope: SigilEnvelope,
  options: SigilProofOptions,
): Promise<SigilEnvelope> {
  const payload = serializeSignedRequestPayload(envelope);
  const payloadHash = await hashSignedRequestPayload(envelope);
  const key = await globalThis.crypto.subtle.importKey(
    "jwk",
    options.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const signature = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(payload),
  );

  return {
    ...envelope,
    proof: {
      version: 1,
      algorithm: "ES256",
      issuer: options.issuer,
      key_id: options.keyId,
      payload_hash: payloadHash,
      signature: bytesToBase64Url(new Uint8Array(signature)),
      public_jwk: options.includePublicJwk ? options.publicJwk ?? derivePublicJwk(options.privateJwk) : undefined,
    },
  };
}

function derivePublicJwk(privateJwk: JsonWebKey): JsonWebKey {
  const { d: _discarded, key_ops: _ops, ...rest } = privateJwk;
  return rest;
}

// ── Callback parsing ───────────────────────────────────────────────────────────

export function parseCallbackResponse(body: unknown): SigilCallbackResponse {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Callback body must be a JSON object");
  }
  const raw = body as Record<string, unknown>;

  const status = raw["status"];
  const nonce = raw["nonce"];
  const type = raw["type"];

  if (typeof status !== "string") throw new Error("Missing or invalid 'status'");
  if (typeof nonce !== "string") throw new Error("Missing or invalid 'nonce'");
  if (typeof type !== "string") throw new Error("Missing or invalid 'type'");

  if (status === "rejected") {
    return { status: "rejected", type: type as SigilRequestType, nonce, reason: "user_rejected" };
  }

  if (status === "signed" && (type === "transfer" || type === "sc_call")) {
    const identity = raw["identity"];
    const tx_hash = raw["tx_hash"];
    const target_tick = raw["target_tick"];
    if (typeof identity !== "string") throw new Error("Missing 'identity'");
    if (typeof tx_hash !== "string") throw new Error("Missing 'tx_hash'");
    if (typeof target_tick !== "number") throw new Error("Missing 'target_tick'");
    return { status: "signed", type, nonce, identity, tx_hash, target_tick };
  }

  if (status === "signed" && type === "sign_message") {
    const identity = raw["identity"];
    const signature = raw["signature"];
    const public_key = raw["public_key"];
    if (typeof identity !== "string") throw new Error("Missing 'identity'");
    if (typeof signature !== "string") throw new Error("Missing 'signature'");
    if (typeof public_key !== "string") throw new Error("Missing 'public_key'");
    return { status: "signed", type: "sign_message", nonce, identity, signature, public_key };
  }

  if (status === "connected" && type === "connect") {
    const identity = raw["identity"];
    const permissions = raw["permissions"];
    if (typeof identity !== "string") throw new Error("Missing 'identity'");
    if (!Array.isArray(permissions)) throw new Error("Missing or invalid 'permissions'");
    return { status: "connected", type: "connect", nonce, identity, permissions: permissions as SigilPermission[] };
  }

  if (status === "verified" && type === "verify_message") {
    const valid = raw["valid"];
    const identity = raw["identity"];
    if (typeof valid !== "boolean") throw new Error("Missing or invalid 'valid'");
    if (typeof identity !== "string") throw new Error("Missing 'identity'");
    return { status: "verified", type: "verify_message", nonce, valid, identity };
  }

  throw new Error(`Unknown callback status/type: "${status}"/"${type}"`);
}

// ── Signature verification ─────────────────────────────────────────────────────

export async function verifyEnvelopeSignature(
  envelope: SigilEnvelope,
  options?: { publicJwk?: JsonWebKey },
): Promise<boolean> {
  const proof = envelope.proof;
  if (!proof) return false;

  const jwk = options?.publicJwk ?? proof.public_jwk;
  if (!jwk) throw new Error("No public key available: provide publicJwk or include it in the proof");

  const key = await globalThis.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  const payload = serializeSignedRequestPayload(envelope);
  const sigBytes = base64UrlToBytes(proof.signature);

  return globalThis.crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    sigBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(payload),
  );
}
