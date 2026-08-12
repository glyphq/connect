import {
	assertRelayNoncePathSegment,
	deriveGlyphSupportId,
	parseCallbackResponse,
	verifyCallbackEnvelope,
	type GlyphCallbackResponse,
	type GlyphCallbackVerificationOptions,
	type GlyphExpectedCallback,
	type GlyphRequest,
	type GlyphRequestStatus,
	type GlyphRequestType,
} from "./index.js";

// ── Types ──────────────────────────────────────────────────────────────────

export const DEFAULT_RELAY_URL = "https://relay.glyphq.org";
const DEFAULT_RELAY_ORIGIN = new URL(DEFAULT_RELAY_URL).origin;
const REGISTERED_RELAY_SESSION: unique symbol = Symbol("glyph.registeredRelaySession");

export type GlyphRelayErrorCode =
	| "invalid_options"
	| "registration_timeout"
	| "registration_failed"
	| "stream_timeout"
	| "stream_interrupted"
	| "stream_failed"
	| "poll_timeout"
	| "poll_failed"
	| "poll_exhausted"
	| "result_pending"
	| "callback_invalid"
	| "callback_verification_failed"
	| "aborted";

const SAFE_RELAY_ERROR_MESSAGES: Record<GlyphRelayErrorCode, string> = {
	invalid_options: "Relay options are invalid",
	registration_timeout: "Relay registration timed out",
	registration_failed: "Relay registration failed",
	stream_timeout: "Relay stream timed out",
	stream_interrupted: "Relay stream was interrupted",
	stream_failed: "Relay stream failed",
	poll_timeout: "Relay result recovery timed out",
	poll_failed: "Relay result recovery failed",
	poll_exhausted: "Relay result recovery was exhausted",
	result_pending: "Relay result is still pending",
	callback_invalid: "Relay callback is invalid",
	callback_verification_failed: "Relay callback verification failed",
	aborted: "Relay operation was aborted",
};

export interface GlyphRelayErrorOptions {
	supportId?: string | null;
	retryable?: boolean;
}

/** A typed, capability-free relay failure suitable for application diagnostics. */
export class GlyphRelayError extends Error {
	override readonly name = "GlyphRelayError";
	readonly code: GlyphRelayErrorCode;
	readonly supportId: string | null;
	readonly retryable: boolean;

	constructor(code: GlyphRelayErrorCode, message?: string, options: GlyphRelayErrorOptions = {}) {
		const safeMessage = SAFE_RELAY_ERROR_MESSAGES[code];
		super(message && Object.values(SAFE_RELAY_ERROR_MESSAGES).includes(message) ? message : safeMessage);
		this.code = code;
		this.supportId = options.supportId ?? null;
		this.retryable = options.retryable ?? [
			"registration_timeout",
			"registration_failed",
			"stream_timeout",
			"stream_interrupted",
			"stream_failed",
			"poll_timeout",
			"poll_failed",
		].includes(code);
		Object.setPrototypeOf(this, new.target.prototype);
	}

	toJSON(): { name: string; code: GlyphRelayErrorCode; message: string; supportId: string | null; retryable: boolean } {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			supportId: this.supportId,
			retryable: this.retryable,
		};
	}
}

export type GlyphRelayMilestone =
	| "session_registered"
	| "stream_open_started"
	| "stream_opened"
	| "wallet_launch_attempted"
	| "awaiting_approval"
	| "result_received_via_sse"
	| "result_recovered_via_poll"
	| "callback_verified"
	| "user_rejected"
	| "timed_out_pending"
	| "failed";

export type GlyphRelayDiagnosticState =
	| "registering"
	| "opening_wallet"
	| "awaiting_approval"
	| "recovering"
	| "completed"
	| "failed";

export interface GlyphRelaySafeError {
	code: GlyphRelayErrorCode;
	message: string;
	supportId: string | null;
	retryable: boolean;
}

/** Snapshot intentionally contains lifecycle metadata only, never callback data or capabilities. */
export interface GlyphRelaySnapshot {
	version: "glyph-relay-snapshot/1";
	state: GlyphRelayDiagnosticState;
	milestone: GlyphRelayMilestone;
	supportId: string | null;
	pollAttempt: number;
	pollMaxAttempts: number;
	error: GlyphRelaySafeError | null;
}

/** Lifecycle event with a sanitized snapshot and no protocol secrets. */
export interface GlyphRelayEvent {
	version: "glyph-relay-event/1";
	milestone: GlyphRelayMilestone;
	at: number;
	supportId: string | null;
	snapshot: GlyphRelaySnapshot;
	error?: GlyphRelaySafeError;
}

export interface GlyphRelayRegistrationOptions {
	/** Abort registration after this many milliseconds. Defaults to 10 000. */
	registrationTimeoutMs?: number;
	/** Alias for registrationTimeoutMs. */
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface GlyphRelayOptions {
	/** Base URL of the official Glyph relay server. Only https://relay.glyphq.org is accepted. */
	relayUrl?: string;
	/** Required when subscribing by nonce string instead of by request object. */
	expectedType?: GlyphRequestType;
	/** Timeout in ms before the SSE stream rejects. Defaults to 300 000 (5 min). */
	timeoutMs?: number;
	/** Explicit SSE stream budget. Overrides timeoutMs when provided. */
	streamTimeoutMs?: number;
	/** Abort registration after this many milliseconds when using prepareRelaySession. */
	registrationTimeoutMs?: number;
	/** Per-request /v2/result polling budget. Defaults to 2 000 ms. */
	pollTimeoutMs?: number;
	/** Delay between bounded /v2/result attempts. Defaults to 250 ms. */
	pollIntervalMs?: number;
	/** Maximum number of /v2/result recovery attempts. Defaults to 3. */
	maxPollAttempts?: number;
	/** Total recovery budget across all /v2/result attempts. */
	recoveryTimeoutMs?: number;
	/** Request hash used only to derive the local support ID. */
	requestHash?: string;
	/** Abort the stream and recovery without relaunching the request. */
	signal?: AbortSignal;
	/** Receives transport-level progress for rendering request feedback. */
	onStatus?: (status: GlyphRequestStatus) => void;
	/** Receives capability-free lifecycle diagnostics. Hook failures are ignored. */
	onEvent?: (event: GlyphRelayEvent) => void;
	/** Receives the current capability-free snapshot. Hook failures are ignored. */
	onSnapshot?: (snapshot: GlyphRelaySnapshot) => void;
	/** Verify signed callback envelopes before resolving. */
	verification?: GlyphCallbackVerificationOptions;
}

export interface GlyphRelayCapabilities {
	/** Shared relay session id. Safe to expose in callback and read URLs. */
	session: string;
	/** Write-only wallet callback capability. Do not expose to readers. */
	callbackCap: string;
	/** Read-only dApp stream/polling capability. Do not put in callback URLs. */
	readCap: string;
}

export interface GlyphRelayUrls extends GlyphRelayCapabilities {
	registerUrl: string;
	callbackUrl: string;
	streamUrl: string;
	resultUrl: string;
}

export interface GlyphPreparedRelaySession extends GlyphRelayUrls {
	registered: true;
	readonly [REGISTERED_RELAY_SESSION]: true;
}

const CAPABILITY_BYTES = 32;

// ── Relay URL and nonce helpers ─────────────────────────────────────────────

function normalizeOfficialRelayUrl(relayUrl = DEFAULT_RELAY_URL): string {
	let url: URL;
	try {
		url = new URL(relayUrl);
	} catch {
		throw new Error("relayUrl must be the official Glyph relay URL");
	}
	if (
		url.origin !== DEFAULT_RELAY_ORIGIN ||
		url.username !== "" ||
		url.password !== "" ||
		url.pathname !== "/" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error("relayUrl must be exactly https://relay.glyphq.org");
	}
	return DEFAULT_RELAY_ORIGIN;
}

function expectedFromSubscription(
	subscription: GlyphRequest | GlyphExpectedCallback | string,
	options: GlyphRelayOptions,
): GlyphExpectedCallback {
	if (typeof subscription === "string") {
		assertRelayNoncePathSegment(subscription);
		if (!options.expectedType) {
			throw new Error("expectedType is required when subscribing to the relay by nonce");
		}
		return { nonce: subscription, type: options.expectedType };
	}
	assertRelayNoncePathSegment(subscription.nonce);
	return { nonce: subscription.nonce, type: subscription.type };
}

function createCapability(prefix = ""): string {
	const bytes = new Uint8Array(CAPABILITY_BYTES);
	globalThis.crypto.getRandomValues(bytes);
	return `${prefix}${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

function assertRelaySession(value: string): void {
	if (!/^[A-Za-z0-9_-]{22,128}$/.test(value)) throw new Error("relay session must be 22-128 base64url characters");
}

function assertRelayCapability(value: string, field: string, prefix: "c_" | "r_"): void {
	if (!value.startsWith(prefix) || !/^[A-Za-z0-9_-]{24,130}$/.test(value)) {
		throw new Error(`${field} must start with '${prefix}' and contain 22-128 base64url capability characters`);
	}
}

export function createRelayCapabilities(options: Partial<GlyphRelayCapabilities> = {}): GlyphRelayCapabilities {
	const capabilities = {
		session: options.session ?? createCapability(),
		callbackCap: options.callbackCap ?? createCapability("c_"),
		readCap: options.readCap ?? createCapability("r_"),
	};
	assertRelaySession(capabilities.session);
	assertRelayCapability(capabilities.callbackCap, "relay callback capability", "c_");
	assertRelayCapability(capabilities.readCap, "relay read capability", "r_");
	if (capabilities.session === capabilities.callbackCap || capabilities.session === capabilities.readCap || capabilities.callbackCap === capabilities.readCap) {
		throw new Error("relay session, callback capability, and read capability must be distinct");
	}
	return capabilities;
}

export function relayUrls(capabilities: GlyphRelayCapabilities = createRelayCapabilities(), relayUrl = DEFAULT_RELAY_URL): GlyphRelayUrls {
	const relay = normalizeOfficialRelayUrl(relayUrl);
	const caps = createRelayCapabilities(capabilities);
	return {
		...caps,
		registerUrl: `${relay}/v2/register/${caps.session}`,
		callbackUrl: `${relay}/v2/callback/${caps.session}/${caps.callbackCap}`,
		streamUrl: `${relay}/v2/stream/${caps.session}/${caps.readCap}`,
		resultUrl: `${relay}/v2/result/${caps.session}/${caps.readCap}`,
	};
}

export async function registerRelaySession(
	capabilities: GlyphRelayCapabilities,
	relayUrl = DEFAULT_RELAY_URL,
	options: GlyphRelayRegistrationOptions = {},
): Promise<GlyphRelayUrls> {
	const urls = relayUrls(capabilities, relayUrl);
	const timeoutMs = boundedMilliseconds(options.registrationTimeoutMs ?? options.timeoutMs, 10_000, "registrationTimeoutMs");
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	const abortFromCaller = () => controller.abort();
	if (options.signal?.aborted) throw new GlyphRelayError("aborted");
	options.signal?.addEventListener("abort", abortFromCaller, { once: true });
	try {
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		let response: Response;
		try {
			response = await fetch(urls.registerUrl, {
				method: "POST",
				signal: controller.signal,
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ callbackCap: urls.callbackCap, readCap: urls.readCap }),
			});
		} catch {
			if (options.signal?.aborted) throw new GlyphRelayError("aborted");
			if (timedOut) throw new GlyphRelayError("registration_timeout");
			throw new GlyphRelayError("registration_failed");
		}
		if (!response.ok) {
			throw new GlyphRelayError(response.status === 408 ? "registration_timeout" : "registration_failed", undefined, {
				retryable: response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
			});
		}
		return urls;
	} finally {
		if (timer) clearTimeout(timer);
		options.signal?.removeEventListener("abort", abortFromCaller);
		controller.abort();
	}
}

export async function prepareRelaySession(
	capabilities: Partial<GlyphRelayCapabilities> = {},
	relayUrl = DEFAULT_RELAY_URL,
	options: GlyphRelayRegistrationOptions = {},
): Promise<GlyphPreparedRelaySession> {
	const urls = await registerRelaySession(createRelayCapabilities(capabilities), relayUrl, options);
	return { ...urls, registered: true, [REGISTERED_RELAY_SESSION]: true };
}

// ── SSE parser ─────────────────────────────────────────────────────────────

/**
 * Parse a standards-compliant SSE stream from a fetch response body.
 * Supports LF, CRLF, CR, comments, event fields, and multi-line data fields.
 */
export async function* parseSSEStream(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let eventName = "";
	let dataBuffer = "";

	function processLine(rawLine: string): { event: string; data: string } | null {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (line === "") {
			if (dataBuffer === "") {
				eventName = "";
				return null;
			}
			const event = { event: eventName || "message", data: dataBuffer.slice(0, -1) };
			eventName = "";
			dataBuffer = "";
			return event;
		}
		if (line.startsWith(":")) return null;

		const colon = line.indexOf(":");
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? "" : line.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);

		if (field === "event") {
			eventName = value;
		} else if (field === "data") {
			dataBuffer += `${value}\n`;
		}
		return null;
	}

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let lineEnd = -1;
			while ((lineEnd = buffer.search(/[\r\n]/)) !== -1) {
				const line = buffer.slice(0, lineEnd);
				const separator = buffer[lineEnd];
				if (separator === "\r" && lineEnd + 1 === buffer.length) break;
				const next = separator === "\r" && buffer[lineEnd + 1] === "\n" ? lineEnd + 2 : lineEnd + 1;
				buffer = buffer.slice(next);
				const event = processLine(line);
				if (event) yield event;
			}
		}

		buffer += decoder.decode();
		if (buffer.endsWith("\r")) {
			const event = processLine(buffer.slice(0, -1));
			if (event) yield event;
			buffer = "";
		}
		if (buffer !== "") {
			const event = processLine(buffer);
			if (event) yield event;
		}
		if (dataBuffer !== "") {
			yield { event: eventName || "message", data: dataBuffer.slice(0, -1) };
		}
	} finally {
		reader.releaseLock();
	}
}

// ── Relay client ───────────────────────────────────────────────────────────

const DEFAULT_STREAM_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_TIMEOUT_MS = 2_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_POLL_ATTEMPTS = 3;
const MAX_RELAY_BUDGET_MS = 15 * 60 * 1000;

function boundedMilliseconds(value: number | undefined, fallback: number, field: string): number {
	const resolved = value ?? fallback;
	if (!Number.isFinite(resolved) || resolved < 0 || resolved > MAX_RELAY_BUDGET_MS) {
		throw new GlyphRelayError("invalid_options", undefined, { retryable: false });
	}
	return Math.floor(resolved);
}

function boundedAttempts(value: number | undefined): number {
	const resolved = value ?? DEFAULT_MAX_POLL_ATTEMPTS;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 20) {
		throw new GlyphRelayError("invalid_options", undefined, { retryable: false });
	}
	return resolved;
}

function safeError(error: GlyphRelayError): GlyphRelaySafeError {
	return {
		code: error.code,
		message: error.message,
		supportId: error.supportId,
		retryable: error.retryable,
	};
}

function relayError(
	code: GlyphRelayErrorCode,
	supportId: string | null,
	options: GlyphRelayErrorOptions = {},
): GlyphRelayError {
	return new GlyphRelayError(code, undefined, { ...options, supportId });
}

function normalizeRelayError(error: unknown, supportId: string | null, fallback: GlyphRelayErrorCode): GlyphRelayError {
	if (error instanceof GlyphRelayError) {
		return error.supportId === supportId ? error : new GlyphRelayError(error.code, error.message, {
			supportId,
			retryable: error.retryable,
		});
	}
	return relayError(fallback, supportId);
}

function notifyStatus(options: GlyphRelayOptions, status: GlyphRequestStatus): void {
	try { options.onStatus?.(status); } catch { /* application hooks cannot break transport recovery */ }
}

class RelayDiagnostics {
	private readonly options: GlyphRelayOptions;
	private readonly supportId: string | null;
	private readonly pollMaxAttempts: number;
	private state: GlyphRelayDiagnosticState = "registering";
	private milestone: GlyphRelayMilestone = "session_registered";
	private pollAttempt = 0;
	private error: GlyphRelaySafeError | null = null;

	constructor(options: GlyphRelayOptions, supportId: string | null, pollMaxAttempts: number) {
		this.options = options;
		this.supportId = supportId;
		this.pollMaxAttempts = pollMaxAttempts;
	}

	snapshot(): GlyphRelaySnapshot {
		return {
			version: "glyph-relay-snapshot/1",
			state: this.state,
			milestone: this.milestone,
			supportId: this.supportId,
			pollAttempt: this.pollAttempt,
			pollMaxAttempts: this.pollMaxAttempts,
			error: this.error,
		};
	}

	emit(milestone: GlyphRelayMilestone, state?: GlyphRelayDiagnosticState, error?: GlyphRelayError): void {
		this.milestone = milestone;
		if (state) this.state = state;
		this.error = error ? safeError(error) : this.error;
		const snapshot = this.snapshot();
		try { this.options.onSnapshot?.(snapshot); } catch { /* diagnostics are advisory */ }
		const event: GlyphRelayEvent = {
			version: "glyph-relay-event/1",
			milestone,
			at: Date.now(),
			supportId: this.supportId,
			snapshot,
		};
		if (error) event.error = safeError(error);
		try { this.options.onEvent?.(event); } catch { /* diagnostics are advisory */ }
	}

	setPollAttempt(attempt: number): void {
		this.pollAttempt = attempt;
		try { this.options.onSnapshot?.(this.snapshot()); } catch { /* diagnostics are advisory */ }
	}
}

function isTransientStatus(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isPendingPollBody(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const body = value as Record<string, unknown>;
	return body.pending === true || body.status === "pending" || body.state === "pending";
}

function isCallbackError(error: unknown): error is GlyphRelayError {
	return error instanceof GlyphRelayError && (
		error.code === "callback_invalid" || error.code === "callback_verification_failed"
	);
}

function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new GlyphRelayError("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(new GlyphRelayError("aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function expectedRequestHash(options: GlyphRelayOptions): string | undefined {
	return options.requestHash ?? options.verification?.expectedRequestHash;
}

async function parseRelayCallback(
	raw: unknown,
	expected: GlyphExpectedCallback,
	options: GlyphRelayOptions,
	supportId: string | null,
): Promise<GlyphCallbackResponse> {
	try {
		return options.verification
			? await verifyCallbackEnvelope(raw, {
				...options.verification,
				expected,
				expectedRequestHash: options.verification.expectedRequestHash ?? options.requestHash,
			})
			: parseCallbackResponse(raw, expected);
	} catch (error) {
		if (isCallbackError(error)) throw error;
		const code = options.verification ? "callback_verification_failed" : "callback_invalid";
		throw relayError(code, supportId, { retryable: false });
	}
}

async function pollRelayResult(
	session: GlyphPreparedRelaySession,
	expected: GlyphExpectedCallback,
	options: GlyphRelayOptions,
	diagnostics: RelayDiagnostics,
	supportId: string | null,
	streamFailure: GlyphRelayError,
): Promise<GlyphCallbackResponse> {
	const pollTimeoutMs = boundedMilliseconds(options.pollTimeoutMs, DEFAULT_POLL_TIMEOUT_MS, "pollTimeoutMs");
	const pollIntervalMs = boundedMilliseconds(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, "pollIntervalMs");
	const maxPollAttempts = boundedAttempts(options.maxPollAttempts);
	const recoveryTimeoutMs = boundedMilliseconds(
		options.recoveryTimeoutMs,
		Math.min(MAX_RELAY_BUDGET_MS, Math.max(pollTimeoutMs, maxPollAttempts * pollTimeoutMs + (maxPollAttempts - 1) * pollIntervalMs)),
		"recoveryTimeoutMs",
	);
	const deadline = Date.now() + recoveryTimeoutMs;
	let sawPending = false;
	let sawJsonResponse = false;
	let sawPollTimeout = false;
	let sawTransientFailure = false;

	for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
		if (options.signal?.aborted) throw relayError("aborted", supportId, { retryable: false });
		const beforeAttempt = Date.now();
		if (attempt > 1) {
			try {
				await waitMs(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), options.signal);
			} catch (error) {
				throw normalizeRelayError(error, supportId, "aborted");
			}
		}
		if (Date.now() >= deadline) break;
		diagnostics.setPollAttempt(attempt);
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;
		const abortFromCaller = () => controller.abort();
		options.signal?.addEventListener("abort", abortFromCaller, { once: true });
		try {
			const remaining = Math.max(1, Math.min(pollTimeoutMs, deadline - Date.now()));
			timer = setTimeout(() => {
				timedOut = true;
				controller.abort();
			}, remaining);
			let response: Response;
			try {
				response = await fetch(session.resultUrl, {
					signal: controller.signal,
					headers: { Accept: "application/json" },
				});
			} catch {
				if (options.signal?.aborted) throw relayError("aborted", supportId, { retryable: false });
				if (timedOut) {
					sawPollTimeout = true;
					continue;
				}
				sawTransientFailure = true;
				continue;
			}
			if (response.status === 202 || response.status === 204 || response.status === 404) {
				sawPending = true;
				continue;
			}
			if (!response.ok) {
				if (isTransientStatus(response.status)) {
					sawTransientFailure = true;
					continue;
				}
				throw relayError("poll_failed", supportId, { retryable: false });
			}
			let raw: unknown;
			try {
				raw = await response.json();
				sawJsonResponse = true;
			} catch {
				continue;
			}
			if (isPendingPollBody(raw)) {
				sawPending = true;
				continue;
			}
			diagnostics.emit("result_recovered_via_poll", "recovering");
			const result = await parseRelayCallback(raw, expected, options, supportId);
			diagnostics.emit("callback_verified", "completed");
			if (result.status === "rejected") diagnostics.emit("user_rejected", "completed");
			return result;
		} catch (error) {
			if (isCallbackError(error)) throw error;
			if (error instanceof GlyphRelayError && error.code === "poll_failed") throw error;
			if (error instanceof GlyphRelayError && error.code === "aborted") throw error;
			if (timedOut) sawPollTimeout = true;
			continue;
		} finally {
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", abortFromCaller);
			controller.abort();
		}
		if (Date.now() - beforeAttempt > recoveryTimeoutMs) break;
	}

	if (sawPending) throw relayError("result_pending", supportId, { retryable: true });
	if (sawJsonResponse) throw relayError("poll_exhausted", supportId, { retryable: true });
	if (sawPollTimeout) throw relayError("poll_timeout", supportId);
	if (sawTransientFailure) throw relayError("poll_exhausted", supportId, { retryable: true });
	throw streamFailure;
}

/** Subscribe to the secure v2 relay stream using a read-only capability. */
export function subscribeViaRelayV2(
	subscription: GlyphRequest | GlyphExpectedCallback | string,
	session: GlyphPreparedRelaySession,
	options: GlyphRelayOptions = {},
): Promise<GlyphCallbackResponse> {
	const expected = expectedFromSubscription(subscription, options);
	const supportHash = expectedRequestHash(options);
	const supportId = supportHash ? deriveGlyphSupportId(supportHash) : null;
	const streamTimeoutMs = boundedMilliseconds(options.streamTimeoutMs ?? options.timeoutMs, DEFAULT_STREAM_TIMEOUT_MS, "streamTimeoutMs");
	const maxPollAttempts = boundedAttempts(options.maxPollAttempts);
	const diagnostics = new RelayDiagnostics(options, supportId, maxPollAttempts);

	return (async () => {
		let streamFailure: GlyphRelayError | undefined;
		notifyStatus(options, { state: "opening_wallet" });
		diagnostics.emit("session_registered", "opening_wallet");
		diagnostics.emit("stream_open_started", "opening_wallet");
		const controller = new AbortController();
		let streamTimer: ReturnType<typeof setTimeout> | undefined;
		let streamTimedOut = false;
		let result: GlyphCallbackResponse | undefined;
		const abortFromCaller = () => controller.abort();
		if (options.signal?.aborted) streamFailure = relayError("aborted", supportId, { retryable: false });
		options.signal?.addEventListener("abort", abortFromCaller, { once: true });
		try {
			if (streamFailure) throw streamFailure;
			streamTimer = setTimeout(() => {
				streamTimedOut = true;
				controller.abort();
			}, streamTimeoutMs);
			let response: Response;
			try {
				response = await fetch(session.streamUrl, {
					signal: controller.signal,
					headers: { Accept: "text/event-stream" },
				});
			} catch {
				if (options.signal?.aborted) throw relayError("aborted", supportId, { retryable: false });
				if (streamTimedOut) throw relayError("stream_timeout", supportId);
				throw relayError("stream_interrupted", supportId);
			}
			if (!response.ok) {
				if (isTransientStatus(response.status)) throw relayError("stream_interrupted", supportId);
				throw relayError("stream_failed", supportId, { retryable: false });
			}
			if (!response.body) throw relayError("stream_interrupted", supportId);
			diagnostics.emit("stream_opened", "opening_wallet");
			diagnostics.emit("awaiting_approval", "awaiting_approval");
			notifyStatus(options, { state: "awaiting_approval" });
			for await (const msg of parseSSEStream(response.body)) {
				if (msg.event === "result") {
					let raw: unknown;
					try { raw = JSON.parse(msg.data) as unknown; } catch { throw relayError("callback_invalid", supportId, { retryable: false }); }
					diagnostics.emit("result_received_via_sse", "awaiting_approval");
					result = await parseRelayCallback(raw, expected, options, supportId);
					diagnostics.emit("callback_verified", "completed");
					if (result.status === "rejected") diagnostics.emit("user_rejected", "completed");
					break;
				}
				if (msg.event === "timeout") throw relayError("stream_timeout", supportId);
				if (msg.event === "close") throw relayError("stream_interrupted", supportId);
			}
			if (!result) throw relayError(streamTimedOut ? "stream_timeout" : "stream_interrupted", supportId);
		} catch (error) {
			const normalized = normalizeRelayError(error, supportId, streamTimedOut ? "stream_timeout" : "stream_interrupted");
			if (normalized.code === "callback_invalid" || normalized.code === "callback_verification_failed" || normalized.code === "aborted") {
				diagnostics.emit("failed", "failed", normalized);
				notifyStatus(options, { state: "failed", error: normalized });
				throw normalized;
			}
			streamFailure = normalized;
		} finally {
			if (streamTimer) clearTimeout(streamTimer);
			options.signal?.removeEventListener("abort", abortFromCaller);
			controller.abort();
		}

		if (!result && streamFailure?.code === "stream_failed") {
			diagnostics.emit("failed", "failed", streamFailure);
			notifyStatus(options, { state: "failed", error: streamFailure });
			throw streamFailure;
		}
		if (!result && streamFailure) {
			const initialStreamFailure = streamFailure;
			try {
				result = await pollRelayResult(session, expected, options, diagnostics, supportId, initialStreamFailure);
			} catch (error) {
				const normalized = normalizeRelayError(error, supportId, initialStreamFailure.code);
				if (normalized.code === "result_pending" || normalized.code === "poll_exhausted") {
					diagnostics.emit("timed_out_pending", "recovering", normalized);
				}
				diagnostics.emit("failed", "failed", normalized);
				notifyStatus(options, { state: "failed", error: normalized });
				throw normalized;
			}
		}
		if (!result) {
			const normalized = relayError("stream_failed", supportId, { retryable: false });
			diagnostics.emit("failed", "failed", normalized);
			notifyStatus(options, { state: "failed", error: normalized });
			throw normalized;
		}
		notifyStatus(options, { state: "completed", result });
		return result;
	})();
}
