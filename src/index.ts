export const GLYPH_DEEP_LINK_SCHEME = "glyph";
export const GLYPH_DEEP_LINK_PREFIX = `${GLYPH_DEEP_LINK_SCHEME}://v1/request`;
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

export interface GlyphEnvelope {
	request: GlyphRequest;
	callback?: string | null;
	redirect_uri?: string | null;
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

function stringToBase64Url(value: string): string {
	return bytesToBase64Url(new TextEncoder().encode(value));
}

export function base64UrlToString(value: string): string {
	return new TextDecoder().decode(base64UrlToBytes(value));
}

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
		const nonce = decodeURIComponent(url.pathname.slice("/v1/callback/".length));
		return (
			url.origin === OFFICIAL_RELAY_ORIGIN &&
			url.username === "" &&
			url.password === "" &&
			url.pathname.startsWith("/v1/callback/") &&
			url.pathname.split("/").length === 4 &&
			url.search === "" &&
			url.hash === "" &&
			isRelayNoncePathSegment(nonce) &&
			encodeURIComponent(nonce) === url.pathname.slice("/v1/callback/".length)
		);
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

function normalizeEnvelope(envelope: GlyphEnvelope): GlyphEnvelope {
	const request = validateGlyphRequest(envelope.request);
	const claimedOrigin = request.dapp.origin;
	if (envelope.callback) assertAllowedDeliveryUrl(envelope.callback, "callback", claimedOrigin);
	if (envelope.redirect_uri) assertAllowedDeliveryUrl(envelope.redirect_uri, "redirect_uri", claimedOrigin);
	return {
		request,
		callback: envelope.callback ?? null,
		redirect_uri: envelope.redirect_uri ?? null,
	};
}

export function createEnvelope(
	request: GlyphRequest,
	options: { callback?: string | null; redirect_uri?: string | null } = {},
): GlyphEnvelope {
	return normalizeEnvelope({
		request,
		callback: options.callback ?? null,
		redirect_uri: options.redirect_uri ?? null,
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

		channel.onmessage = (e: MessageEvent) => {
			try {
				const result = parseCallbackResponse(e.data, request);
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
export function handleRedirect(options: GlyphRedirectOptions = {}): GlyphRedirectResult {
	if (typeof window === "undefined") return { status: "missing" };
	const encoded = new URLSearchParams(window.location.search).get("result");
	if (!encoded) return { status: "missing" };
	try {
		const raw = JSON.parse(base64UrlToString(encoded)) as unknown;
		const result = parseCallbackResponse(raw);
		const channel = new BroadcastChannel(`${GLYPH_RESULT_CHANNEL_PREFIX}${result.nonce}`);
		channel.postMessage(result);
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
	subscribeViaRelay,
	relayCallbackUrl,
	DEFAULT_RELAY_URL,
	type GlyphRelayOptions,
} from "./relay-client.js";

export function parseCallbackResponse(
	body: unknown,
	expected?: GlyphExpectedCallback,
): GlyphCallbackResponse {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
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
