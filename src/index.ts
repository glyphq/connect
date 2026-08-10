export const GLYPH_DEEP_LINK_SCHEME = "glyph";
export const GLYPH_DEEP_LINK_PREFIX = `${GLYPH_DEEP_LINK_SCHEME}://v2/request`;
export const GLYPH_RESULT_CHANNEL_PREFIX = "glyph:result:";
export const DEFAULT_GLYPH_CALLBACK_PATH = "/__glyph__";

export type GlyphPermission = "transfer" | "sc_call" | "sign_message";
export type GlyphRequestType =
	| "transfer"
	| "sc_call"
	| "sign_message"
	| "verify_message"
	| "connect";

export interface GlyphDappMeta {
	name?: string;
	origin: string;
	icon?: string;
}

export interface GlyphBaseRequest {
	type: GlyphRequestType;
	dapp: GlyphDappMeta;
	nonce: string;
	exp?: number;
}

export interface GlyphTransferRequest extends GlyphBaseRequest {
	type: "transfer";
	to: string;
	amount: string | number;
	from?: string;
	tick_offset?: number;
}

export interface GlyphScCallRequest extends GlyphBaseRequest {
	type: "sc_call";
	contract_index: number;
	input_type: number;
	from?: string;
	amount?: string | number;
	payload?: string;
	tick_offset?: number;
}

export interface GlyphSignMessageRequest extends GlyphBaseRequest {
	type: "sign_message";
	message: string;
	from?: string;
	data?: string;
}

export interface GlyphVerifyMessageRequest extends GlyphBaseRequest {
	type: "verify_message";
	message: string;
	data?: string;
	signature: string;
	public_key: string;
}

export interface GlyphConnectRequest extends GlyphBaseRequest {
	type: "connect";
	permissions?: GlyphPermission[];
}

export type GlyphRequest =
	| GlyphTransferRequest
	| GlyphScCallRequest
	| GlyphSignMessageRequest
	| GlyphVerifyMessageRequest
	| GlyphConnectRequest;

export const GLYPH_REQUEST_ENVELOPE_PROTOCOL = "glyph-connect-request/2";

export type GlyphKnownNetworkId = "qubic:mainnet" | "qubic:testnet";
export type GlyphCustomNetworkId = `qubic:custom:sha256:${string}`;
export type GlyphNetworkId = GlyphKnownNetworkId | GlyphCustomNetworkId;

export interface GlyphNetworkBinding { id: GlyphNetworkId }
export interface GlyphCustomNetworkRpc { [key: string]: unknown }

export const GLYPH_MAINNET: GlyphNetworkBinding = Object.freeze({ id: "qubic:mainnet" });
export const GLYPH_TESTNET: GlyphNetworkBinding = Object.freeze({ id: "qubic:testnet" });

export interface GlyphEnvelope {
    protocol: typeof GLYPH_REQUEST_ENVELOPE_PROTOCOL;
	request: GlyphRequest;
	callback?: string | null;
	redirect_uri?: string | null;
	network: GlyphNetworkBinding;
	request_hash: string;
}

export const GLYPH_CALLBACK_ENVELOPE_VERSION = "glyph-connect-callback-envelope/2";
export const GLYPH_CALLBACK_SIGNATURE_ALGORITHM = "qubic-schnorrq-sha256";

export interface GlyphCallbackRelayBinding {
	callback_url: string | null;
	official_relay: boolean;
	route: "v1_callback" | "v2_session_callback" | "unknown" | null;
	v1_nonce: string | null;
	session_id: string | null;
	callback_capability_fingerprint: string | null;
}

export interface GlyphCallbackSignaturePayload {
	version: typeof GLYPH_CALLBACK_ENVELOPE_VERSION;
	request_hash: string;
	network: GlyphNetworkBinding;
	nonce: string;
	dapp_origin: string;
	request_type: GlyphRequestType;
	exp: number | null;
	issued_at: number;
	result_hash: string;
	relay: GlyphCallbackRelayBinding;
}

export interface GlyphSignedCallbackEnvelope {
	version: typeof GLYPH_CALLBACK_ENVELOPE_VERSION;
	result: GlyphCallbackResponse;
	payload: GlyphCallbackSignaturePayload;
	proof: {
		algorithm: typeof GLYPH_CALLBACK_SIGNATURE_ALGORITHM;
		identity: string;
		public_key: string;
		signature: string;
		signed_payload: string;
	};
}

export interface GlyphCallbackVerificationOptions {
	expected?: GlyphExpectedCallback;
	expectedRequestHash?: string;
	expectedNetwork?: GlyphNetworkBinding;
	/** Expected dapp.origin bound into the signed callback payload. */
	expectedDappOrigin?: string;
	/** Expected request exp bound into the signed callback payload. Use null when absent. */
	expectedExp?: number | null;
	/** Expected callback URL bound into the signed callback payload relay object. */
	expectedCallbackUrl?: string | null;
	/** Require a signed envelope instead of accepting legacy unsigned callbacks. */
	requireSigned?: boolean;
	/** Restrict accepted wallet callback verification keys. */
	trustedPublicKeys?: string[];
	/** Custom verifier. Required for schnorrq until WebCrypto supports it. */
	verifySignature?: (input: {
		algorithm: typeof GLYPH_CALLBACK_SIGNATURE_ALGORITHM;
		payload: Uint8Array;
		signature: Uint8Array;
		publicKey: Uint8Array;
		envelope: GlyphSignedCallbackEnvelope;
	}) => boolean | Promise<boolean>;
}

// ── Callback response types ────────────────────────────────────────────────────

export interface GlyphSignedTransferCallback {
	status: "signed";
	type: "transfer" | "sc_call";
	nonce: string;
	identity: string;
	tx_hash: string;
	target_tick: number;
}

export interface GlyphSignedMessageCallback {
	status: "signed";
	type: "sign_message";
	nonce: string;
	identity: string;
	signature: string;
	public_key: string;
}

export interface GlyphConnectedCallback {
	status: "connected";
	type: "connect";
	nonce: string;
	identity: string;
	permissions: GlyphPermission[];
}

export interface GlyphVerifiedCallback {
	status: "verified";
	type: "verify_message";
	nonce: string;
	valid: boolean;
	identity: string;
}

export interface GlyphRejectedCallback {
	status: "rejected";
	type: GlyphRequestType;
	nonce: string;
	reason: "user_rejected";
}

export type GlyphCallbackResponse =
	| GlyphSignedTransferCallback
	| GlyphSignedMessageCallback
	| GlyphConnectedCallback
	| GlyphVerifiedCallback
	| GlyphRejectedCallback;

export interface GlyphExpectedCallback {
	nonce: string;
	type: GlyphRequestType;
}

export interface GlyphRequestDefaults {
	nonce?: string;
	exp?: number;
	ttlSeconds?: number;
}

export interface GlyphAsyncOptions {
	/** Path on your origin where handleRedirect() is mounted. Defaults to '/__glyph__'. */
	callbackPath?: string;
	/** Timeout in ms before the Promise rejects. Defaults to 300 000 (5 min). */
	timeoutMs?: number;
	/** Attempt to focus the originating dApp when a result arrives. Defaults to true. */
	focusOnResult?: boolean;
	/** Receives transport-level progress for rendering request feedback. */
	onStatus?: (status: GlyphRequestStatus) => void;
	/** Verification options for signed v2 callback envelopes. */
	verification?: Omit<GlyphCallbackVerificationOptions, "expected">;
}

export type GlyphRequestStatus =
	| { state: "opening_wallet" }
	| { state: "awaiting_approval" }
	| { state: "completed"; result: GlyphCallbackResponse }
	| { state: "failed"; error: Error };

export interface GlyphRedirectOptions {
	/** Delay before attempting to close the callback tab. Defaults to 0. */
	closeDelayMs?: number;
	/** Attempt to close the callback tab after delivery. Defaults to true. */
	closeWindow?: boolean;
	/** Attempt to focus window.opener when one is available. Defaults to true. */
	focusOpener?: boolean;
	/** Called after a valid result has been broadcast. */
	onResult?: (result: GlyphCallbackResponse) => void;
	/** Called when the result query parameter cannot be parsed. */
	onError?: (error: Error) => void;
	/** Verification options for signed v2 callback envelopes. */
	verification?: GlyphCallbackVerificationOptions;
}

export type GlyphRedirectResult =
	| { status: "handled"; result: GlyphCallbackResponse }
	| { status: "missing" }
	| { status: "invalid"; error: Error };

const DEFAULT_EXPIRY_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_NONCE_AGE_SECONDS = 60 * 60;
const MAX_ENCODED_PAYLOAD_BYTES = 8192;
const MAX_SIGN_MESSAGE_CHARS = 2048;
const MAX_INT64 = BigInt("9223372036854775807");
const OFFICIAL_RELAY_ORIGIN = "https://relay.glyphq.org";
const GLYPH_PERMISSIONS = new Set<GlyphPermission>(["transfer", "sc_call", "sign_message"]);
const GLYPH_REQUEST_TYPES = new Set<GlyphRequestType>([
	"transfer",
	"sc_call",
	"sign_message",
	"verify_message",
	"connect",
]);

// ── Encoding helpers ───────────────────────────────────────────────────────────

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

function base64UrlToBytes(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(value)) {
		throw new Error("Invalid base64url value");
	}
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
	if (typeof Buffer !== "undefined") {
		return new Uint8Array(Buffer.from(padded, "base64"));
	}
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function base64UrlToByteArray(value: string): Uint8Array {
	return base64UrlToBytes(value);
}

function stringToBase64Url(value: string): string {
	return bytesToBase64Url(new TextEncoder().encode(value));
}

export function base64UrlToString(value: string): string {
	return new TextDecoder().decode(base64UrlToBytes(value));
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// RFC8785/JCS-compatible canonical JSON for protocol hashes. It rejects values
// that cannot be represented in I-JSON and emits object members in deterministic
// UTF-16 key order, matching ECMAScript/RFC8785 sorting for JSON strings.
export function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot encode non-finite numbers");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record).sort().map((key) => {
			const item = record[key];
			if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
				throw new Error("Canonical JSON cannot encode unsupported values");
			}
			return `${JSON.stringify(key)}:${canonicalJson(item)}`;
		}).join(",")}}`;
	}
	throw new Error("Canonical JSON cannot encode unsupported values");
}

function rotr(n: number, x: number): number { return (x >>> n) | (x << (32 - n)); }
function sha256(bytes: Uint8Array): Uint8Array {
	const k = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
	const h = [1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];
	const bitLen = bytes.length * 8; const len = (((bytes.length + 9 + 63) >> 6) << 6); const m = new Uint8Array(len); m.set(bytes); m[bytes.length] = 0x80;
	new DataView(m.buffer).setUint32(len - 4, bitLen, false);
	const w = new Uint32Array(64);
	for (let i = 0; i < len; i += 64) {
		const v = new DataView(m.buffer, i, 64); for (let t = 0; t < 16; t++) w[t] = v.getUint32(t * 4, false);
		for (let t = 16; t < 64; t++) { const wm15 = w[t-15]!; const wm2 = w[t-2]!; const s0 = rotr(7,wm15) ^ rotr(18,wm15) ^ (wm15 >>> 3); const s1 = rotr(17,wm2) ^ rotr(19,wm2) ^ (wm2 >>> 10); w[t] = (w[t-16]! + s0 + w[t-7]! + s1) >>> 0; }
		let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
		for (let t = 0; t < 64; t++) { const S1 = rotr(6,e) ^ rotr(11,e) ^ rotr(25,e); const ch = (e & f) ^ (~e & g); const temp1 = (hh + S1 + ch + k[t]! + w[t]!) >>> 0; const S0 = rotr(2,a) ^ rotr(13,a) ^ rotr(22,a); const maj = (a & b) ^ (a & c) ^ (b & c); const temp2 = (S0 + maj) >>> 0; hh = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0; }
		h[0]=(h[0]!+a)>>>0; h[1]=(h[1]!+b)>>>0; h[2]=(h[2]!+c)>>>0; h[3]=(h[3]!+d)>>>0; h[4]=(h[4]!+e)>>>0; h[5]=(h[5]!+f)>>>0; h[6]=(h[6]!+g)>>>0; h[7]=(h[7]!+hh)>>>0;
	}
	const out = new Uint8Array(32); const dv = new DataView(out.buffer); h.forEach((x,i)=>dv.setUint32(i*4,x,false)); return out;
}

export function sha256Base64UrlSync(input: string): string { return bytesToBase64Url(sha256(new TextEncoder().encode(input))); }
export function sha256CanonicalJson(value: unknown): string { return `sha256:${sha256Base64UrlSync(canonicalJson(value))}`; }

// ── Validation helpers ─────────────────────────────────────────────────────────

function isGlyphPermission(value: unknown): value is GlyphPermission {
	return typeof value === "string" && GLYPH_PERMISSIONS.has(value as GlyphPermission);
}

function isGlyphRequestType(value: unknown): value is GlyphRequestType {
	return typeof value === "string" && GLYPH_REQUEST_TYPES.has(value as GlyphRequestType);
}

function readString(raw: Record<string, unknown>, field: string): string {
	const value = raw[field];
	if (typeof value !== "string") throw new Error(`Missing or invalid '${field}'`);
	return value;
}

function readNumber(raw: Record<string, unknown>, field: string): number {
	const value = raw[field];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Missing or invalid '${field}'`);
	}
	return value;
}

function readBoolean(raw: Record<string, unknown>, field: string): boolean {
	const value = raw[field];
	if (typeof value !== "boolean") throw new Error(`Missing or invalid '${field}'`);
	return value;
}

function normalizeHost(host: string): string {
	return host.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

function parseIpv4(host: string): number[] | null {
	const parts = host.split(".");
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => {
		if (!/^\d{1,3}$/.test(part)) return Number.NaN;
		const value = Number(part);
		return value >= 0 && value <= 255 ? value : Number.NaN;
	});
	return octets.every(Number.isInteger) ? octets : null;
}

function isNonGlobalIpv4(octets: number[]): boolean {
	const [a = 0, b = 0, c = 0, d = 0] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0 && (c === 0 || c === 2)) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		(a >= 224 && a <= 239) ||
		(a >= 240 && a <= 255) ||
		(a === 255 && b === 255 && c === 255 && d === 255)
	);
}

function parseIpv4MappedIpv6(host: string): number[] | null {
	const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
	if (mapped?.[1]) return parseIpv4(mapped[1]);
	const hexMapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
	if (!hexMapped?.[1] || !hexMapped[2]) return null;
	const high = Number.parseInt(hexMapped[1], 16);
	const low = Number.parseInt(hexMapped[2], 16);
	return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isNonGlobalIpv6(host: string): boolean {
	const lower = host.toLowerCase();
	const mapped = parseIpv4MappedIpv6(lower);
	if (mapped) return isNonGlobalIpv4(mapped);
	return (
		lower === "::" ||
		lower === "::1" ||
		lower.startsWith("fc") ||
		lower.startsWith("fd") ||
		lower.startsWith("fe8") ||
		lower.startsWith("fe9") ||
		lower.startsWith("fea") ||
		lower.startsWith("feb") ||
		lower.startsWith("ff") ||
		lower.startsWith("2001:db8:") ||
		lower === "2001:db8::1"
	);
}

export function isPrivateHost(host: string): boolean {
	const normalized = normalizeHost(host.trim());
	if (normalized === "localhost") return true;
	const ipv4 = parseIpv4(normalized);
	if (ipv4) return isNonGlobalIpv4(ipv4);
	if (normalized.includes(":")) return isNonGlobalIpv6(normalized);
	return false;
}

function assertPublicHost(host: string, fieldName: string): void {
	if (!host || isPrivateHost(host)) {
		throw new Error(`${fieldName} must not target a non-global address`);
	}
}

export function canonicalDappOrigin(origin: string): string {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		throw new Error("dApp origin must be a valid URL");
	}
	if (
		url.protocol !== "https:" ||
		!url.hostname ||
		url.username !== "" ||
		url.password !== "" ||
		url.pathname !== "/" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error("dApp origin must be a credential-free HTTPS origin");
	}
	assertPublicHost(url.hostname, "dApp origin");
	return url.origin;
}

function parseIntegerLike(value: string | number, field: string): bigint {
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer`);
		return BigInt(value);
	}
	if (!/^-?\d+$/.test(value)) throw new Error(`${field} must be an integer`);
	return BigInt(value);
}

function assertNonce(value: string, field = "nonce"): void {
	if (value.length < 16 || value.length > 128) {
		throw new Error(`${field} must be 16-128 characters`);
	}
	if (!/^[A-Za-z0-9_+=-]+$/.test(value)) {
		throw new Error(`${field} must use a base64url-safe or alphanumeric charset`);
	}
}

export function isRelayNoncePathSegment(value: string): boolean {
	return value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function assertRelayNoncePathSegment(value: string): void {
	if (!isRelayNoncePathSegment(value)) {
		throw new Error("relay nonce must be 16-128 characters using only A-Z, a-z, 0-9, '-' or '_'");
	}
}

function assertExpiry(exp: number | undefined): void {
	if (exp === undefined) return;
	if (!Number.isSafeInteger(exp)) throw new Error("exp must be a unix timestamp integer");
	const now = unixNow();
	if (exp <= now) throw new Error("request has expired");
	if (exp > now + MAX_NONCE_AGE_SECONDS) {
		throw new Error("request expiry too far in the future (max 1 hour)");
	}
}

function assertPermissions(permissions: GlyphPermission[] | undefined): void {
	if (permissions === undefined) return;
	if (!Array.isArray(permissions) || !permissions.every(isGlyphPermission)) {
		throw new Error("connect: permissions contains an unknown permission");
	}
}

export function validateGlyphRequest(request: GlyphRequest): GlyphRequest {
	if (!request || typeof request !== "object") throw new Error("request must be an object");
	if (!isGlyphRequestType(request.type)) throw new Error(`unknown request type: ${String(request.type)}`);
	assertNonce(request.nonce);
	assertExpiry(request.exp);
	const origin = canonicalDappOrigin(request.dapp?.origin);

	switch (request.type) {
		case "transfer": {
			if (typeof request.to !== "string" || request.to.length === 0) {
				throw new Error("transfer: missing 'to'");
			}
			const amount = parseIntegerLike(request.amount, "transfer: 'amount'");
			if (amount <= 0n || amount > MAX_INT64) throw new Error("transfer: 'amount' must be positive");
			break;
		}
		case "sc_call": {
			if (!Number.isInteger(request.contract_index) || request.contract_index < 0 || request.contract_index > 63) {
				throw new Error("sc_call: 'contract_index' out of range");
			}
			if (!Number.isInteger(request.input_type) || request.input_type < 0) {
				throw new Error("sc_call: 'input_type' must be non-negative");
			}
			if (request.amount !== undefined) {
				const amount = parseIntegerLike(request.amount, "sc_call: 'amount'");
				if (amount < 0n || amount > MAX_INT64) throw new Error("sc_call: 'amount' must be non-negative");
			}
			break;
		}
		case "sign_message":
			if (typeof request.message !== "string" || request.message.length === 0) {
				throw new Error("sign_message: 'message' must not be empty");
			}
			if ([...request.message].length > MAX_SIGN_MESSAGE_CHARS) {
				throw new Error("sign_message: 'message' exceeds 2048 characters");
			}
			break;
		case "verify_message":
			if (typeof request.message !== "string" || request.message.length === 0) {
				throw new Error("verify_message: 'message' must not be empty");
			}
			if (typeof request.signature !== "string") throw new Error("verify_message: missing 'signature'");
			if (typeof request.public_key !== "string") throw new Error("verify_message: missing 'public_key'");
			break;
		case "connect":
			assertPermissions(request.permissions);
			break;
	}

	return {
		...request,
		dapp: {
			...request.dapp,
			origin,
		},
	} as GlyphRequest;
}

export function isOfficialRelayCallbackUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.origin !== OFFICIAL_RELAY_ORIGIN || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return false;
		if (url.pathname.startsWith("/v2/callback/") && url.pathname.split("/").length === 5) {
			const parts = url.pathname.split("/").map(decodeURIComponent);
			const session = parts[3];
			const callbackCap = parts[4];
			return typeof session === "string" && typeof callbackCap === "string"
				&& /^[A-Za-z0-9_-]{22,128}$/.test(session)
				&& /^c_[A-Za-z0-9_-]{22,128}$/.test(callbackCap)
				&& session !== callbackCap;
		}
		return false;
	} catch {
		return false;
	}
}

export function isAllowedDeliveryUrl(
	value: string,
	claimedOrigin: string,
	options: { allowOfficialRelayCallback?: boolean } = {},
): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || !url.hostname) {
			return false;
		}
		if (isPrivateHost(url.hostname)) return false;
		const canonicalOrigin = canonicalDappOrigin(claimedOrigin);
		return (
			url.origin === canonicalOrigin ||
			(Boolean(options.allowOfficialRelayCallback) && isOfficialRelayCallbackUrl(value))
		);
	} catch {
		return false;
	}
}

export function isAllowedCallbackUrl(value: string, claimedOrigin?: string): boolean {
	if (claimedOrigin === undefined) {
		try {
			const url = new URL(value);
			return url.protocol === "https:" && url.username === "" && url.password === "" && !isPrivateHost(url.hostname);
		} catch {
			return false;
		}
	}
	return isAllowedDeliveryUrl(value, claimedOrigin, { allowOfficialRelayCallback: true });
}

function assertAllowedDeliveryUrl(
	value: string,
	fieldName: "callback" | "redirect_uri",
	claimedOrigin: string,
): void {
	const allowed = isAllowedDeliveryUrl(value, claimedOrigin, {
		allowOfficialRelayCallback: fieldName === "callback",
	});
	if (!allowed) {
		throw new Error(
			fieldName === "callback"
				? "callback must use HTTPS without credentials, target a global address, match dapp.origin, or be the official relay callback"
				: "redirect_uri must use HTTPS without credentials, target a global address, and match dapp.origin",
		);
	}
}

// ── Nonce / expiry ─────────────────────────────────────────────────────────────

function unixNow(): number {
	return Math.floor(Date.now() / 1000);
}

export function createNonce(): string {
	const crypto = globalThis.crypto;
	if (typeof crypto?.randomUUID === "function") {
		return crypto.randomUUID().replace(/-/g, "");
	}
	if (typeof crypto?.getRandomValues === "function") {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		return bytesToBase64Url(bytes);
	}
	throw new Error("crypto.randomUUID or crypto.getRandomValues is required to create a nonce");
}

export function createExpiry(ttlSeconds = DEFAULT_EXPIRY_SECONDS): number {
	if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
		throw new Error("ttlSeconds must be a positive number");
	}
	if (ttlSeconds > MAX_NONCE_AGE_SECONDS) {
		throw new Error("ttlSeconds must not exceed 3600 seconds");
	}
	return unixNow() + Math.floor(ttlSeconds);
}

export function withRequestDefaults<T extends Omit<GlyphRequest, "nonce" | "exp">>(
	request: T,
	defaults: GlyphRequestDefaults = {},
): T & Pick<GlyphBaseRequest, "nonce" | "exp"> {
	const withDefaults = {
		...request,
		dapp: {
			...request.dapp,
			origin: canonicalDappOrigin(request.dapp.origin),
		},
		nonce: defaults.nonce ?? createNonce(),
		exp: defaults.exp ?? createExpiry(defaults.ttlSeconds),
	} as T & Pick<GlyphBaseRequest, "nonce" | "exp">;
	return validateGlyphRequest(withDefaults as GlyphRequest) as T & Pick<GlyphBaseRequest, "nonce" | "exp">;
}

// ── Request factories ──────────────────────────────────────────────────────────

export function createTransferRequest(
	request: Omit<GlyphTransferRequest, "nonce" | "exp">,
	defaults?: GlyphRequestDefaults,
): GlyphTransferRequest {
	return withRequestDefaults(request, defaults);
}

export function createScCallRequest(
	request: Omit<GlyphScCallRequest, "nonce" | "exp">,
	defaults?: GlyphRequestDefaults,
): GlyphScCallRequest {
	return withRequestDefaults(request, defaults);
}

export function createSignMessageRequest(
	request: Omit<GlyphSignMessageRequest, "nonce" | "exp">,
	defaults?: GlyphRequestDefaults,
): GlyphSignMessageRequest {
	return withRequestDefaults(request, defaults);
}

export function createVerifyMessageRequest(
	request: Omit<GlyphVerifyMessageRequest, "nonce" | "exp">,
	defaults?: GlyphRequestDefaults,
): GlyphVerifyMessageRequest {
	return withRequestDefaults(request, defaults);
}

export function createConnectRequest(
	request: Omit<GlyphConnectRequest, "nonce" | "exp">,
	defaults?: GlyphRequestDefaults,
): GlyphConnectRequest {
	return withRequestDefaults(request, defaults);
}

// ── Envelope ───────────────────────────────────────────────────────────────────

export function createCustomNetworkBinding(rpc: GlyphCustomNetworkRpc): GlyphNetworkBinding {
	return { id: `qubic:custom:${sha256CanonicalJson(rpc)}` as GlyphCustomNetworkId };
}

function validateNetworkBinding(network: GlyphNetworkBinding): GlyphNetworkBinding {
	if (!isJsonObject(network) || typeof network.id !== "string") throw new Error("network binding must include an id");
	if (network.id === "qubic:mainnet" || network.id === "qubic:testnet" || /^qubic:custom:sha256:[A-Za-z0-9_-]{43}$/.test(network.id)) return { id: network.id as GlyphNetworkId };
	throw new Error("network id is invalid");
}

export function requestHashInput(envelope: Pick<GlyphEnvelope, "protocol" | "request" | "callback" | "redirect_uri" | "network">): Pick<GlyphEnvelope, "protocol" | "request" | "callback" | "redirect_uri" | "network"> {
	return {
		protocol: envelope.protocol,
		request: envelope.request,
		callback: envelope.callback ?? null,
		redirect_uri: envelope.redirect_uri ?? null,
		network: envelope.network,
	};
}

export function computeRequestHash(envelope: Pick<GlyphEnvelope, "protocol" | "request" | "callback" | "redirect_uri" | "network">): string {
	return sha256CanonicalJson(requestHashInput(envelope));
}

function normalizeEnvelope(envelope: Partial<GlyphEnvelope> & { request: GlyphRequest }): GlyphEnvelope {
	const request = validateGlyphRequest(envelope.request);
	const claimedOrigin = request.dapp.origin;
	if (envelope.callback) assertAllowedDeliveryUrl(envelope.callback, "callback", claimedOrigin);
	if (envelope.redirect_uri) assertAllowedDeliveryUrl(envelope.redirect_uri, "redirect_uri", claimedOrigin);
	const normalized: Pick<GlyphEnvelope, "protocol" | "request" | "callback" | "redirect_uri" | "network"> = {
		protocol: GLYPH_REQUEST_ENVELOPE_PROTOCOL,
		request,
		callback: envelope.callback ?? null,
		redirect_uri: envelope.redirect_uri ?? null,
		network: validateNetworkBinding(envelope.network ?? GLYPH_MAINNET),
	};
	const request_hash = computeRequestHash(normalized);
	if (envelope.request_hash !== undefined && envelope.request_hash !== request_hash) throw new Error("request_hash does not match envelope");
	return { ...normalized, request_hash };
}

export function createEnvelope(
	request: GlyphRequest,
	options: { callback?: string | null; redirect_uri?: string | null; network?: GlyphNetworkBinding } = {},
): GlyphEnvelope {
	return normalizeEnvelope({
		request,
		callback: options.callback ?? null,
		redirect_uri: options.redirect_uri ?? null,
		network: options.network ?? GLYPH_MAINNET,
	});
}

export function encodeEnvelope(envelope: GlyphEnvelope): string {
	const normalized = normalizeEnvelope(envelope);
	const encoded = stringToBase64Url(JSON.stringify(normalized));
	if (encoded.length > MAX_ENCODED_PAYLOAD_BYTES) {
		throw new Error("payload too large (max 8192 bytes base64)");
	}
	return encoded;
}

export function buildGlyphUrl(envelope: GlyphEnvelope): string {
	const payload = encodeEnvelope(envelope);
	const params = new URLSearchParams({ d: payload });
	return `${GLYPH_DEEP_LINK_PREFIX}?${params.toString()}`;
}

// ── Browser launch ─────────────────────────────────────────────────────────────

export function openGlyphUrl(url: string): void {
	if (typeof window === "undefined") {
		throw new Error("openGlyphUrl can only be used in a browser environment");
	}
	const a = document.createElement("a");
	a.href = url;
	a.style.display = "none";
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

export function launchGlyphRequest(envelope: GlyphEnvelope): string {
	const url = buildGlyphUrl(envelope);
	openGlyphUrl(url);
	return url;
}

// ── Async request API ──────────────────────────────────────────────────────────

/**
 * Launch a Glyph request and await the result as a Promise.
 *
 * Opens Glyph via a link click (the page stays alive). After the user acts,
 * Glyph opens `redirect_uri?result=<base64url JSON>` in the browser. The page
 * at that path must call `handleRedirect()`. It broadcasts the result over a
 * BroadcastChannel and this Promise resolves after validating the expected
 * nonce and request type.
 *
 * @example
 * // In your main app:
 * const result = await glyphRequest(createTransferRequest({...}));
 *
 * // At your callbackPath route (defaults to /__glyph__):
 * import { handleRedirect } from '@glyph-oss/connect';
 * handleRedirect();
 */
export async function glyphRequest(
	req: GlyphRequest,
	options: GlyphAsyncOptions = {},
): Promise<GlyphCallbackResponse> {
	if (typeof window === "undefined") {
		throw new Error("glyphRequest() can only be used in a browser environment");
	}
	const request = validateGlyphRequest(req);
	const callbackPath = options.callbackPath ?? DEFAULT_GLYPH_CALLBACK_PATH;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const focusOnResult = options.focusOnResult ?? true;
	const redirectUri = `${window.location.origin}${callbackPath}`;
	const envelope = createEnvelope(request, { redirect_uri: redirectUri });
	const url = buildGlyphUrl(envelope);

	return new Promise<GlyphCallbackResponse>((resolve, reject) => {
		const channel = new BroadcastChannel(`${GLYPH_RESULT_CHANNEL_PREFIX}${request.nonce}`);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timer) clearTimeout(timer);
			channel.close();
		};
		const fail = (error: unknown) => {
			cleanup();
			const normalizedError = error instanceof Error ? error : new Error(String(error));
			options.onStatus?.({ state: "failed", error: normalizedError });
			reject(normalizedError);
		};
		timer = setTimeout(() => {
			fail(new Error("Glyph request timed out"));
		}, timeoutMs);

		channel.onmessage = async (e: MessageEvent) => {
			try {
				const result = await parseOrVerifyCallback(e.data, {
					...options.verification,
					expected: request,
					expectedRequestHash: envelope.request_hash,
					expectedNetwork: envelope.network,
					requireSigned: true,
				});
				cleanup();
				if (focusOnResult) window.focus();
				options.onStatus?.({ state: "completed", result });
				resolve(result);
			} catch (err) {
				fail(err);
			}
		};

		try {
			options.onStatus?.({ state: "opening_wallet" });
			openGlyphUrl(url);
			options.onStatus?.({ state: "awaiting_approval" });
		} catch (err) {
			fail(err);
		}
	});
}

/**
 * Call this at the route/page pointed to by your `callbackPath` (default `/__glyph__`).
 * Reads the `?result=` query param, validates the callback shape, broadcasts it
 * to the waiting `glyphRequest()` Promise, then closes the tab.
 */

export async function handleRedirect(options: GlyphRedirectOptions = {}): Promise<GlyphRedirectResult> {
	if (typeof window === "undefined") return { status: "missing" };
	const encoded = new URLSearchParams(window.location.search).get("result");
	if (!encoded) return { status: "missing" };
	try {
		const raw = JSON.parse(base64UrlToString(encoded)) as unknown;
		const result = options.verification
			? await parseOrVerifyCallback(raw, options.verification)
			: parseCallbackResponse(isSignedCallbackEnvelope(raw) ? raw.result : raw);
		const channel = new BroadcastChannel(`${GLYPH_RESULT_CHANNEL_PREFIX}${result.nonce}`);
		channel.postMessage(isSignedCallbackEnvelope(raw) ? raw : result);
		channel.close();
		if ((options.focusOpener ?? true) && window.opener && !window.opener.closed) {
			window.opener.focus();
		}
		options.onResult?.(result);
		if (options.closeWindow ?? true) {
			window.setTimeout(() => window.close(), Math.max(0, options.closeDelayMs ?? 0));
		}
		return { status: "handled", result };
	} catch (cause) {
		const error = cause instanceof Error ? cause : new Error("Invalid Glyph callback result");
		options.onError?.(error);
		return { status: "invalid", error };
	}
}

// ── Callback parsing ───────────────────────────────────────────────────────────

export {
	subscribeViaRelayV2,
	relayUrls,
	createRelayCapabilities,
	registerRelaySession,
	prepareRelaySession,
	DEFAULT_RELAY_URL,
	type GlyphRelayOptions,
	type GlyphRelayCapabilities,
	type GlyphRelayUrls,
	type GlyphPreparedRelaySession,
} from "./relay-client.js";

export function parseCallbackResponse(
	body: unknown,
	expected?: GlyphExpectedCallback,
): GlyphCallbackResponse {
	if (!isJsonObject(body)) {
		throw new Error("Callback body must be a JSON object");
	}
	const raw = body as Record<string, unknown>;
	const status = readString(raw, "status");
	const nonce = readString(raw, "nonce");
	const type = readString(raw, "type");

	if (!isGlyphRequestType(type)) {
		throw new Error(`Unknown callback request type: "${type}"`);
	}
	if (expected && nonce !== expected.nonce) {
		throw new Error("Callback nonce does not match the expected request nonce");
	}
	if (expected && type !== expected.type) {
		throw new Error("Callback type does not match the expected request type");
	}

	if (status === "rejected") {
		const reason = readString(raw, "reason");
		if (reason !== "user_rejected") {
			throw new Error(`Unknown rejection reason: "${reason}"`);
		}
		return { status: "rejected", type, nonce, reason: "user_rejected" };
	}

	if (status === "signed" && (type === "transfer" || type === "sc_call")) {
		return {
			status: "signed",
			type,
			nonce,
			identity: readString(raw, "identity"),
			tx_hash: readString(raw, "tx_hash"),
			target_tick: readNumber(raw, "target_tick"),
		};
	}

	if (status === "signed" && type === "sign_message") {
		return {
			status: "signed",
			type: "sign_message",
			nonce,
			identity: readString(raw, "identity"),
			signature: readString(raw, "signature"),
			public_key: readString(raw, "public_key"),
		};
	}

	if (status === "connected" && type === "connect") {
		const permissions = raw["permissions"];
		if (!Array.isArray(permissions) || !permissions.every(isGlyphPermission)) {
			throw new Error("Missing or invalid 'permissions'");
		}
		return {
			status: "connected",
			type: "connect",
			nonce,
			identity: readString(raw, "identity"),
			permissions,
		};
	}

	if (status === "verified" && type === "verify_message") {
		return {
			status: "verified",
			type: "verify_message",
			nonce,
			valid: readBoolean(raw, "valid"),
			identity: readString(raw, "identity"),
		};
	}

	throw new Error(`Unknown callback status/type: "${status}"/"${type}"`);
}

export function isSignedCallbackEnvelope(body: unknown): body is GlyphSignedCallbackEnvelope {
	if (!isJsonObject(body)) return false;
	const proof = body.proof;
	return (
		body.version === GLYPH_CALLBACK_ENVELOPE_VERSION &&
		isJsonObject(body.result) &&
		isJsonObject(body.payload) &&
		isJsonObject(proof) &&
		proof.algorithm === GLYPH_CALLBACK_SIGNATURE_ALGORITHM &&
		typeof proof.identity === "string" &&
		typeof proof.public_key === "string" &&
		typeof proof.signature === "string" &&
		typeof proof.signed_payload === "string"
	);
}

function expectsSignedCallback(options: GlyphCallbackVerificationOptions): boolean {
	return Boolean(
		options.requireSigned ||
		options.expectedRequestHash !== undefined ||
		options.expectedNetwork !== undefined ||
		options.expectedDappOrigin !== undefined ||
		options.expectedExp !== undefined ||
		options.expectedCallbackUrl !== undefined ||
		options.trustedPublicKeys !== undefined ||
		options.verifySignature !== undefined,
	);
}

export async function parseOrVerifyCallback(
	body: unknown,
	options: GlyphCallbackVerificationOptions = {},
): Promise<GlyphCallbackResponse> {
	if (isSignedCallbackEnvelope(body) || expectsSignedCallback(options)) {
		return verifyCallbackEnvelope(body, options);
	}
	return parseCallbackResponse(body, options.expected);
}

function canonicalize(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

function base64ToBytes(value: string): Uint8Array {
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) throw new Error("Invalid base64 value");
	if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function sha256Base64Url(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return bytesToBase64Url(new Uint8Array(digest));
}

/**
 * Mirror Wallet's signed relay binding without retaining the write capability
 * in the callback payload. All other callback URLs remain raw bindings.
 */
async function canonicalizeExpectedCallbackUrl(callbackUrl: string | null): Promise<string | null> {
	if (callbackUrl === null) return null;
	try {
		const url = new URL(callbackUrl);
		if (url.origin !== OFFICIAL_RELAY_ORIGIN || url.search || url.hash) return callbackUrl;
		const v2 = url.pathname.match(/^\/v2\/callback\/([A-Za-z0-9_-]{16,128})\/([A-Za-z0-9_-]{16,256})$/);
		if (!v2) return callbackUrl;
		return `${url.origin}/v2/callback/${v2[1]!}/${await sha256Base64Url(v2[2]!)}`;
	} catch {
		return callbackUrl;
	}
}

function assertCallbackRelayBinding(relay: GlyphCallbackRelayBinding): void {
	if (!isJsonObject(relay)) throw new Error("Callback payload relay binding must be an object");
	if (relay.callback_url !== null && typeof relay.callback_url !== "string") throw new Error("Callback relay callback_url is invalid");
	if (typeof relay.official_relay !== "boolean") throw new Error("Callback relay official_relay is invalid");
	if (!(relay.route === "v1_callback" || relay.route === "v2_session_callback" || relay.route === "unknown" || relay.route === null)) {
		throw new Error("Callback relay route is invalid");
	}
	if (relay.v1_nonce !== null && typeof relay.v1_nonce !== "string") throw new Error("Callback relay v1_nonce is invalid");
	if (relay.session_id !== null && typeof relay.session_id !== "string") throw new Error("Callback relay session_id is invalid");
	if (relay.callback_capability_fingerprint !== null && typeof relay.callback_capability_fingerprint !== "string") {
		throw new Error("Callback relay callback_capability_fingerprint is invalid");
	}
}

export async function verifyCallbackEnvelope(
	body: unknown,
	options: GlyphCallbackVerificationOptions = {},
): Promise<GlyphCallbackResponse> {
	if (!isSignedCallbackEnvelope(body)) {
		if (expectsSignedCallback(options)) throw new Error("Callback body must be a signed Glyph callback envelope");
		return parseCallbackResponse(body, options.expected);
	}

	const result = parseCallbackResponse(body.result, options.expected);
	if (body.payload.version !== GLYPH_CALLBACK_ENVELOPE_VERSION) throw new Error("Callback payload version is invalid");
	if (typeof body.payload.request_hash !== "string" || !body.payload.request_hash.startsWith("sha256:")) throw new Error("Callback payload request_hash is invalid");
	validateNetworkBinding(body.payload.network);
	if (body.payload.nonce !== result.nonce) throw new Error("Callback payload nonce does not match result nonce");
	if (body.payload.request_type !== result.type) throw new Error("Callback payload request type does not match result type");
	if (typeof body.payload.dapp_origin !== "string") throw new Error("Callback payload dapp_origin is invalid");
	if (body.payload.exp !== null && !Number.isSafeInteger(body.payload.exp)) throw new Error("Callback payload exp is invalid");
	if (!Number.isSafeInteger(body.payload.issued_at)) throw new Error("Callback payload issued_at is invalid");
	assertCallbackRelayBinding(body.payload.relay);
	if (options.expectedRequestHash !== undefined && body.payload.request_hash !== options.expectedRequestHash) {
		throw new Error("Callback payload request_hash does not match expected request");
	}
	if (options.expectedNetwork !== undefined && body.payload.network.id !== validateNetworkBinding(options.expectedNetwork).id) {
		throw new Error("Callback payload network does not match expected network");
	}
	if (options.expectedDappOrigin !== undefined && body.payload.dapp_origin !== canonicalDappOrigin(options.expectedDappOrigin)) {
		throw new Error("Callback payload dapp_origin does not match expected origin");
	}
	if (options.expectedExp !== undefined && body.payload.exp !== options.expectedExp) {
		throw new Error("Callback payload exp does not match expected request expiry");
	}
	if (options.expectedCallbackUrl !== undefined) {
		const expectedCallbackUrl = await canonicalizeExpectedCallbackUrl(options.expectedCallbackUrl);
		if (body.payload.relay.callback_url !== expectedCallbackUrl) {
			throw new Error("Callback payload relay callback_url does not match expected callback URL");
		}
	}
	if (body.proof.signed_payload !== canonicalJson(body.payload)) throw new Error("Callback signed_payload is not canonical");
	if (!/^sha256:[A-Za-z0-9_-]{43}$/.test(body.payload.result_hash)) throw new Error("Callback payload result_hash is invalid");
	if (body.payload.result_hash !== sha256CanonicalJson(body.result)) {
		throw new Error("Callback payload result_hash does not match result");
	}
	const signature = base64ToBytes(body.proof.signature);
	const publicKey = base64ToBytes(body.proof.public_key);
	if (options.trustedPublicKeys && !options.trustedPublicKeys.includes(body.proof.public_key)) {
		throw new Error("Callback envelope public key is not trusted");
	}
	if (!options.verifySignature) throw new Error("verifySignature is required to verify Qubic SchnorrQ callback envelopes");

	const verified = await options.verifySignature({
		algorithm: GLYPH_CALLBACK_SIGNATURE_ALGORITHM,
		payload: new TextEncoder().encode(body.proof.signed_payload),
		signature,
		publicKey,
		envelope: body,
	});
	if (!verified) throw new Error("Callback envelope signature is invalid");
	return result;
}
