import {
	assertRelayNoncePathSegment,
	parseCallbackResponse,
	type GlyphCallbackResponse,
	type GlyphExpectedCallback,
	type GlyphRequest,
	type GlyphRequestStatus,
	type GlyphRequestType,
} from "./index.js";

// ── Types ──────────────────────────────────────────────────────────────────

export const DEFAULT_RELAY_URL = "https://relay.glyphq.org";
const DEFAULT_RELAY_ORIGIN = new URL(DEFAULT_RELAY_URL).origin;

export interface GlyphRelayOptions {
	/** Base URL of the official Glyph relay server. Only https://relay.glyphq.org is accepted. */
	relayUrl?: string;
	/** Required when subscribing by nonce string instead of by request object. */
	expectedType?: GlyphRequestType;
	/** Timeout in ms before the SSE stream rejects. Defaults to 300 000 (5 min). */
	timeoutMs?: number;
	/** Receives transport-level progress for rendering request feedback. */
	onStatus?: (status: GlyphRequestStatus) => void;
}

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

/**
 * Subscribe to the official relay SSE stream and return the validated result.
 *
 * Opens a streaming `fetch()` to `GET /v1/stream/:nonce` on
 * `https://relay.glyphq.org`. The result is accepted only when its nonce and
 * request type match the expected request.
 *
 * @example
 * const request = createConnectRequest({ type: "connect", dapp: { origin: "https://demo.app" } });
 * const stream = subscribeViaRelay(request);
 * const callbackUrl = relayCallbackUrl(request.nonce);
 * launchGlyphRequest(createEnvelope(request, { callback: callbackUrl }));
 * const result = await stream;
 */
export function subscribeViaRelay(
	subscription: GlyphRequest | GlyphExpectedCallback | string,
	options: GlyphRelayOptions = {},
): Promise<GlyphCallbackResponse> {
	const relayUrl = normalizeOfficialRelayUrl(options.relayUrl);
	const expected = expectedFromSubscription(subscription, options);
	const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;

	return new Promise<GlyphCallbackResponse>((resolve, reject) => {
		let settled = false;
		let abort: AbortController | undefined;

		const fail = (reason: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			abort?.abort();
			const error = reason instanceof Error ? reason : new Error(String(reason));
			options.onStatus?.({ state: "failed", error });
			reject(error);
		};

		const timer = setTimeout(() => {
			fail(new Error("Relay stream timed out"));
		}, timeoutMs);

		options.onStatus?.({ state: "opening_wallet" });
		abort = new AbortController();

		fetch(`${relayUrl}/v1/stream/${encodeURIComponent(expected.nonce)}`, {
			signal: abort.signal,
			headers: { Accept: "text/event-stream" },
		})
			.then(async (response) => {
				if (!response.ok) throw new Error(`Relay returned ${response.status}`);
				if (!response.body) throw new Error("Relay returned no body");

				options.onStatus?.({ state: "awaiting_approval" });

				for await (const msg of parseSSEStream(response.body)) {
					if (settled) break;

					if (msg.event === "result") {
						try {
							const raw = JSON.parse(msg.data) as unknown;
							const result = parseCallbackResponse(raw, expected);
							settled = true;
							clearTimeout(timer);
							abort?.abort();
							options.onStatus?.({ state: "completed", result });
							resolve(result);
						} catch (err) {
							fail(err);
						}
						break;
					}

					if (msg.event === "timeout") {
						fail(new Error("Relay stream timed out"));
						break;
					}

					if (msg.event === "close" && !settled) {
						fail(new Error("Relay stream closed without a result"));
						break;
					}
				}

				if (!settled) fail(new Error("Relay stream ended without a result"));
			})
			.catch((err) => {
				if (settled && err instanceof Error && err.name === "AbortError") return;
				fail(err);
			});
	});
}

/**
 * Build the official relay callback URL for a relay-backed Glyph request.
 *
 * Use the request nonce as the relay nonce so the callback URL and SSE stream
 * are deliberately bound to the same expected result.
 */
export function relayCallbackUrl(
	nonce: string,
	relayUrl: string = DEFAULT_RELAY_URL,
): string {
	const relay = normalizeOfficialRelayUrl(relayUrl);
	assertRelayNoncePathSegment(nonce);
	return `${relay}/v1/callback/${encodeURIComponent(nonce)}`;
}
