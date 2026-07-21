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
const LOCAL_CALLBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
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

function assertAllowedCallbackUrl(value: string, fieldName: "callback" | "redirect_uri"): void {
	if (!isAllowedCallbackUrl(value)) {
		throw new Error(`${fieldName} must use HTTPS or localhost HTTP`);
	}
}

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

export function isAllowedCallbackUrl(value: string): boolean {
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase();
		const isLocal = LOCAL_CALLBACK_HOSTS.has(host);
		return url.protocol === "https:" || (url.protocol === "http:" && isLocal);
	} catch {
		return false;
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
	return unixNow() + Math.floor(ttlSeconds);
}

export function withRequestDefaults<T extends Omit<GlyphRequest, "nonce" | "exp">>(
	request: T,
	defaults: GlyphRequestDefaults = {},
): T & Pick<GlyphBaseRequest, "nonce" | "exp"> {
	assertValidDappOrigin(request.dapp.origin);
	return {
		...request,
		nonce: defaults.nonce ?? createNonce(),
		exp: defaults.exp ?? createExpiry(defaults.ttlSeconds),
	};
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

export function createEnvelope(
	request: GlyphRequest,
	options: { callback?: string | null; redirect_uri?: string | null } = {},
): GlyphEnvelope {
	if (options.callback) assertAllowedCallbackUrl(options.callback, "callback");
	if (options.redirect_uri) assertAllowedCallbackUrl(options.redirect_uri, "redirect_uri");
	return {
		request,
		callback: options.callback ?? null,
		redirect_uri: options.redirect_uri ?? null,
	};
}

export function encodeEnvelope(envelope: GlyphEnvelope): string {
	if (envelope.callback) assertAllowedCallbackUrl(envelope.callback, "callback");
	if (envelope.redirect_uri) assertAllowedCallbackUrl(envelope.redirect_uri, "redirect_uri");
	return stringToBase64Url(JSON.stringify(envelope));
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
 * BroadcastChannel and this Promise resolves.
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
	const callbackPath = options.callbackPath ?? DEFAULT_GLYPH_CALLBACK_PATH;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const focusOnResult = options.focusOnResult ?? true;
	const redirectUri = `${window.location.origin}${callbackPath}`;
	const envelope = createEnvelope(req, { redirect_uri: redirectUri });
	const url = buildGlyphUrl(envelope);

	return new Promise<GlyphCallbackResponse>((resolve, reject) => {
		const channel = new BroadcastChannel(`${GLYPH_RESULT_CHANNEL_PREFIX}${req.nonce}`);
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
			cleanup();
			try {
				const result = parseCallbackResponse(e.data);
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
 * Reads the `?result=` query param, broadcasts it to the waiting `glyphRequest()` Promise,
 * then closes the tab.
 *
 * @example
 * // pages/__glyph__.tsx  (or equivalent in your framework)
 * import { handleRedirect } from '@glyph-oss/connect';
 * handleRedirect();
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

export function parseCallbackResponse(body: unknown): GlyphCallbackResponse {
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
