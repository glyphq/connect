import { afterEach, describe, expect, test } from "bun:test";
import { GlyphRelayError, type GlyphCallbackResponse, canonicalJson, createConnectRequest, deriveGlyphSupportId, parseOrVerifyCallback, sha256CanonicalJson, verifyCallbackEnvelope } from "./index";
import {
	createRelayCapabilities,
	parseSSEStream,
	prepareRelaySession,
	relayUrls,
	subscribeViaRelayV2,
} from "./relay-client";

const originalFetch = globalThis.fetch;

function validNonce(prefix = "nonce"): string {
	return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
			controller.close();
		},
	});
}

function sseEvent(data: string, event: string, lineEnding = "\n"): string {
	return `event: ${event}${lineEnding}data: ${data}${lineEnding}${lineEnding}`;
}

function b64(value: string): string {
	return Buffer.from(value).toString("base64");
}

function signedEnvelope(result: GlyphCallbackResponse, overrides: Record<string, unknown> = {}) {
	const payload = {
		version: "glyph-connect-callback-envelope/2" as const,
		request_hash: "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		network: { id: "qubic:mainnet" as const },
		nonce: result.nonce,
		dapp_origin: "https://demo.app",
		request_type: result.type,
		exp: null,
		issued_at: 1,
		result_hash: sha256CanonicalJson(result),
		relay: { callback_url: null, official_relay: false, route: null, v1_nonce: null, session_id: null, callback_capability_fingerprint: null },
		...overrides,
	};
	return {
		version: "glyph-connect-callback-envelope/2" as const,
		result,
		payload,
		proof: {
			algorithm: "qubic-schnorrq-sha256" as const,
			identity: "wallet-identity",
			public_key: b64("public-key"),
			signature: b64("signature"),
			signed_payload: canonicalJson(payload),
		},
	};
}

function canonicalize(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

async function sha256Base64Url(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return Buffer.from(digest).toString("base64url");
}

function mockFetchWithSse(chunks: string[], assertUrl?: (url: string, init?: RequestInit) => void) {
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		assertUrl?.(String(input), init);
		return Promise.resolve(
			new Response(sseStream(chunks), {
				headers: { "Content-Type": "text/event-stream" },
			}),
		);
	}) as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("relay client", () => {
	test("relay v2 helpers split callback and read capabilities", () => {
		const caps = createRelayCapabilities();
		expect(caps.session).not.toBe(caps.callbackCap);
		expect(caps.callbackCap).not.toBe(caps.readCap);
		expect(caps.callbackCap.startsWith("c_")).toBe(true);
		expect(caps.readCap.startsWith("r_")).toBe(true);
		const urls = relayUrls(caps);
		expect(urls.registerUrl).toBe(`https://relay.glyphq.org/v2/register/${caps.session}`);
		expect(urls.callbackUrl).toBe(`https://relay.glyphq.org/v2/callback/${caps.session}/${caps.callbackCap}`);
		expect(urls.streamUrl).toBe(`https://relay.glyphq.org/v2/stream/${caps.session}/${caps.readCap}`);
		expect(urls.resultUrl).toBe(`https://relay.glyphq.org/v2/result/${caps.session}/${caps.readCap}`);
		expect(urls.callbackUrl).not.toContain(caps.readCap);
		expect(urls.streamUrl).not.toContain(caps.callbackCap);
		expect(() => createRelayCapabilities({ session: caps.session, callbackCap: caps.session, readCap: caps.readCap })).toThrow("callback capability");
		expect(() => createRelayCapabilities({ session: caps.session, callbackCap: caps.callbackCap, readCap: caps.callbackCap })).toThrow("read capability");
	});

	test("prepareRelaySession registers caps before the stream is opened", async () => {
		const caps = createRelayCapabilities();
		const request = createConnectRequest({ type: "connect", dapp: { origin: "https://demo.app" } });
		const result: GlyphCallbackResponse = { status: "connected", type: "connect", nonce: request.nonce, identity: "AAAA", permissions: ["transfer"] };
		const calls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push(`${init?.method ?? "GET"} ${url}`);
			if (url === `https://relay.glyphq.org/v2/register/${caps.session}`) {
				expect(init?.method).toBe("POST");
				expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
				expect((init?.headers as Record<string, string>).Accept).toBe("application/json");
				expect(JSON.parse(String(init?.body))).toEqual({ callbackCap: caps.callbackCap, readCap: caps.readCap });
				return Promise.resolve(new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } }));
			}
			expect(url).toBe(`https://relay.glyphq.org/v2/stream/${caps.session}/${caps.readCap}`);
			expect(url).not.toContain(caps.callbackCap);
			return Promise.resolve(new Response(sseStream([sseEvent(JSON.stringify(result), "result")]), { headers: { "Content-Type": "text/event-stream" } }));
		}) as typeof fetch;

		const prepared = await prepareRelaySession(caps);
		expect(prepared.registered).toBe(true);
		await expect(subscribeViaRelayV2(request, prepared, { timeoutMs: 2_000 })).resolves.toEqual(result);
		expect(calls).toEqual([
				`POST https://relay.glyphq.org/v2/register/${caps.session}`,
				`GET https://relay.glyphq.org/v2/stream/${caps.session}/${caps.readCap}`,
		]);
	});

	test("registration uses a bounded abort budget and a typed safe error", async () => {
		const caps = createRelayCapabilities();
		globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
		})) as typeof fetch;
		const error = await prepareRelaySession(caps, undefined, { registrationTimeoutMs: 5 }).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(GlyphRelayError);
		expect((error as GlyphRelayError).code).toBe("registration_timeout");
		expect((error as GlyphRelayError).message).toBe("Relay registration timed out");
	});

	test("verifyCallbackEnvelope verifies signed payloads with a custom verifier", async () => {
		const result: GlyphCallbackResponse = { status: "connected", type: "connect", nonce: validNonce("signed"), identity: "AAAA", permissions: ["transfer"] };
		const envelope = signedEnvelope(result);
		const signedPayload = envelope.proof.signed_payload;
		await expect(verifyCallbackEnvelope(envelope, {
			expected: { nonce: result.nonce, type: result.type },
			trustedPublicKeys: [envelope.proof.public_key],
			expectedDappOrigin: "https://demo.app",
			expectedExp: null,
			verifySignature(input) {
				expect(input.algorithm).toBe("qubic-schnorrq-sha256");
				expect(new TextDecoder().decode(input.payload)).toBe(signedPayload);
				return true;
			},
		})).resolves.toEqual(result);
		await expect(verifyCallbackEnvelope(envelope, { requireSigned: true, verifySignature: () => false })).rejects.toThrow("signature is invalid");
	});

	test("parseOrVerifyCallback routes signed v2 envelopes and rejects tampering", async () => {
		const result: GlyphCallbackResponse = { status: "connected", type: "connect", nonce: validNonce("route"), identity: "AAAA", permissions: ["transfer"] };
		const envelope = signedEnvelope(result);
		await expect(parseOrVerifyCallback(envelope, { verifySignature: () => true })).resolves.toEqual(result);
		await expect(parseOrVerifyCallback({ ...envelope, result: { ...result, nonce: validNonce("other") } }, { verifySignature: () => true })).rejects.toThrow("does not match result");
	});

	test("verifyCallbackEnvelope rejects unsigned v2 expectations", async () => {
		const result: GlyphCallbackResponse = { status: "connected", type: "connect", nonce: validNonce("unsigned"), identity: "AAAA", permissions: ["transfer"] };
		await expect(verifyCallbackEnvelope(result, { expectedRequestHash: "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).rejects.toThrow("signed Glyph callback envelope");
		await expect(verifyCallbackEnvelope(result, { expectedNetwork: { id: "qubic:mainnet" } })).rejects.toThrow("signed Glyph callback envelope");
		await expect(verifyCallbackEnvelope(result, { trustedPublicKeys: [b64("public-key")] })).rejects.toThrow("signed Glyph callback envelope");
		await expect(verifyCallbackEnvelope(result, { verifySignature: () => true })).rejects.toThrow("signed Glyph callback envelope");
	});

	test("verifyCallbackEnvelope requires string v2 payload version", async () => {
		const result: GlyphCallbackResponse = { status: "connected", type: "connect", nonce: validNonce("payload-version"), identity: "AAAA", permissions: ["transfer"] };
		await expect(verifyCallbackEnvelope(signedEnvelope(result, { version: 2 }), { verifySignature: () => true })).rejects.toThrow("payload version is invalid");
	});

	test("verifyCallbackEnvelope accepts exact Wallet signed envelope shape including rejection", async () => {
		const result: GlyphCallbackResponse = {
			status: "rejected",
			type: "connect",
			nonce: "wallet_fixture_nonce_0123456789abcdef",
			reason: "user_rejected",
		};
		const payload = {
			version: "glyph-connect-callback-envelope/2" as const,
			request_hash: "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			network: { id: "qubic:mainnet" as const },
			nonce: result.nonce,
			dapp_origin: "https://demo.app",
			request_type: "connect" as const,
			exp: null,
			issued_at: 1720000000,
			result_hash: sha256CanonicalJson(result),
			relay: {
				callback_url: "https://relay.glyphq.org/v2/callback/s_123/c_456",
				official_relay: true,
				route: "v2_session_callback" as const,
				v1_nonce: null,
				session_id: "s_123",
				callback_capability_fingerprint: "sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
			},
		};
		const walletEnvelope = {
			version: "glyph-connect-callback-envelope/2" as const,
			result,
			payload,
			proof: {
				algorithm: "qubic-schnorrq-sha256" as const,
				identity: "wallet-identity",
				public_key: b64("wallet-public-key"),
				signature: b64("wallet-signature"),
				signed_payload: canonicalJson(payload),
			},
		};

		await expect(verifyCallbackEnvelope(walletEnvelope, {
			expected: { nonce: result.nonce, type: "connect" },
			expectedRequestHash: payload.request_hash,
			expectedNetwork: payload.network,
			expectedDappOrigin: "https://demo.app",
			expectedExp: null,
			expectedCallbackUrl: payload.relay.callback_url,
			trustedPublicKeys: [walletEnvelope.proof.public_key],
			verifySignature(input) {
				expect(input.envelope).toBe(walletEnvelope);
				expect(new TextDecoder().decode(input.payload)).toBe(walletEnvelope.proof.signed_payload);
				return true;
			},
		})).resolves.toEqual(result);
	});

	test("verifyCallbackEnvelope accepts Wallet's sanitized official v2 callback binding", async () => {
		const result: GlyphCallbackResponse = { status: "connected", type: "connect", nonce: validNonce("v2-callback"), identity: "AAAA", permissions: ["transfer"] };
		const session = "session_1234567890abcdef";
		const callbackCap = "c_callbackCapabilitySecret_1234567890abcdef";
		const callbackUrl = `https://relay.glyphq.org/v2/callback/${session}/${callbackCap}`;
		const callbackCapabilityFingerprint = await sha256Base64Url(callbackCap);
		const envelope = signedEnvelope(result, {
			relay: {
				callback_url: `https://relay.glyphq.org/v2/callback/${session}/${callbackCapabilityFingerprint}`,
				official_relay: true,
				route: "v2_session_callback" as const,
				v1_nonce: null,
				session_id: session,
				callback_capability_fingerprint: callbackCapabilityFingerprint,
			},
		});

		expect(envelope.proof.signed_payload).not.toContain(callbackCap);
		await expect(verifyCallbackEnvelope(envelope, {
			expected: { nonce: result.nonce, type: result.type },
			expectedCallbackUrl: callbackUrl,
			verifySignature: () => true,
		})).resolves.toEqual(result);
		await expect(verifyCallbackEnvelope(signedEnvelope(result, {
			relay: {
				callback_url: callbackUrl,
				official_relay: true,
				route: "v2_session_callback" as const,
				v1_nonce: null,
				session_id: session,
				callback_capability_fingerprint: callbackCapabilityFingerprint,
			},
		}), {
			expectedCallbackUrl: callbackUrl,
			verifySignature: () => true,
		})).rejects.toThrow("callback_url does not match");
		await expect(verifyCallbackEnvelope(envelope, {
			expectedCallbackUrl: `https://relay.glyphq.org/v2/callback/${session}/c_wrongCallbackCapability_1234567890abcdef`,
			verifySignature: () => true,
		})).rejects.toThrow("callback_url does not match");
		await expect(verifyCallbackEnvelope(envelope, {
			expectedCallbackUrl: `https://relay.glyphq.org/v2/callback/session_wrong_1234567890abcdef/${callbackCap}`,
			verifySignature: () => true,
		})).rejects.toThrow("callback_url does not match");
	});

	test("verifyCallbackEnvelope keeps legacy and nonrelay callback bindings strict", async () => {
		const result: GlyphCallbackResponse = { status: "connected", type: "connect", nonce: validNonce("raw-callback"), identity: "AAAA", permissions: ["transfer"] };
		for (const relay of [
			{
				callback_url: "https://relay.glyphq.org/v1/callback/legacy_nonce_1234567890abcdef",
				official_relay: true,
				route: "v1_callback" as const,
				v1_nonce: "legacy_nonce_1234567890abcdef",
				session_id: null,
				callback_capability_fingerprint: null,
			},
			{
				callback_url: "https://demo.app/callback",
				official_relay: false,
				route: "unknown" as const,
				v1_nonce: null,
				session_id: null,
				callback_capability_fingerprint: null,
			},
		]) {
			const envelope = signedEnvelope(result, { relay });
			await expect(verifyCallbackEnvelope(envelope, {
				expectedCallbackUrl: relay.callback_url,
				verifySignature: () => true,
			})).resolves.toEqual(result);
			await expect(verifyCallbackEnvelope(envelope, {
				expectedCallbackUrl: `${relay.callback_url}/other`,
				verifySignature: () => true,
			})).rejects.toThrow("callback_url does not match");
		}
	});

	test("verifyCallbackEnvelope rejects wrong expected request hash and network", async () => {
		const result: GlyphCallbackResponse = { status: "connected", type: "connect", nonce: validNonce("wrong"), identity: "AAAA", permissions: ["transfer"] };
		const envelope = signedEnvelope(result);
		await expect(verifyCallbackEnvelope(envelope, { expectedRequestHash: "sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", verifySignature: () => true })).rejects.toThrow("request_hash does not match");
		await expect(verifyCallbackEnvelope(envelope, { expectedNetwork: { id: "qubic:testnet" }, verifySignature: () => true })).rejects.toThrow("network does not match");
	});

	test("subscribeViaRelayV2 calls onStatus with progress events", async () => {
		const caps = createRelayCapabilities();
		const session = { ...relayUrls(caps), registered: true as const } as Awaited<ReturnType<typeof prepareRelaySession>>;
		const nonce = validNonce("status");
		const statuses: string[] = [];
		const result: GlyphCallbackResponse = {
			status: "rejected",
			type: "connect",
			nonce,
			reason: "user_rejected",
		};
		mockFetchWithSse([sseEvent(JSON.stringify(result), "result")]);

		await subscribeViaRelayV2(
			{ nonce, type: "connect" },
			session,
			{ timeoutMs: 2_000, onStatus: (status) => statuses.push(status.state) },
		);
		expect(statuses).toContain("opening_wallet");
		expect(statuses).toContain("awaiting_approval");
		expect(statuses).toContain("completed");
	});

	test("subscribeViaRelayV2 rejects on relay timeout event", async () => {
		const caps = createRelayCapabilities();
		const session = { ...relayUrls(caps), registered: true as const } as Awaited<ReturnType<typeof prepareRelaySession>>;
		const nonce = validNonce("timeout");
		mockFetchWithSse([sseEvent(JSON.stringify({ status: "timeout" }), "timeout")]);
		await expect(
			subscribeViaRelayV2({ nonce, type: "connect" }, session, { timeoutMs: 2_000 }),
		).rejects.toThrow("Relay stream timed out");
	});

	test("parseSSEStream handles CRLF and multi-data events", async () => {
		const events = [] as Array<{ event: string; data: string }>;
		for await (const event of parseSSEStream(
			sseStream([
				": keepalive\r\n",
				"event: result\r\n",
				"data: {\"a\":1,\r\n",
				"data: \"b\":2}\r\n\r\n",
			]),
		)) {
			events.push(event);
		}
		expect(events).toEqual([{ event: "result", data: '{"a":1,\n"b":2}' }]);
	});

	test("parseSSEStream treats split CRLF after event lines as one newline", async () => {
		const events = [] as Array<{ event: string; data: string }>;
		for await (const event of parseSSEStream(
			sseStream(["event: result\r", "\n", "data: {\"ok\":true}\r\n", "\r\n"]),
		)) {
			events.push(event);
		}
		expect(events).toEqual([{ event: "result", data: '{"ok":true}' }]);
	});

	test("parseSSEStream treats split CRLF after data lines as one newline", async () => {
		const events = [] as Array<{ event: string; data: string }>;
		for await (const event of parseSSEStream(
			sseStream(["event: result\r\n", "data: {\"ok\":true}\r", "\n", "\r\n"]),
		)) {
			events.push(event);
		}
		expect(events).toEqual([{ event: "result", data: '{"ok":true}' }]);
	});

	test("subscribeViaRelayV2 resolves a result event when CRLF is split across chunks", async () => {
		const request = createConnectRequest({
			type: "connect",
			dapp: { origin: "https://demo.app" },
		});
		const result: GlyphCallbackResponse = {
			status: "connected",
			type: "connect",
			nonce: request.nonce,
			identity: "AAAA",
			permissions: ["transfer"],
		};
		mockFetchWithSse([
			"event: result\r",
			"\n",
			`data: ${JSON.stringify(result)}\r`,
			"\n",
			"\r\n",
		]);

		const caps = createRelayCapabilities();
		const session = { ...relayUrls(caps), registered: true as const } as Awaited<ReturnType<typeof prepareRelaySession>>;

		await expect(subscribeViaRelayV2(request, session, { timeoutMs: 2_000 })).resolves.toEqual(result);
	});

	test("recovers a timed out SSE callback through bounded signed result polling", async () => {
		const request = createConnectRequest({ type: "connect", dapp: { origin: "https://demo.app" } });
		const result: GlyphCallbackResponse = {
			status: "connected",
			type: "connect",
			nonce: request.nonce,
			identity: "AAAA",
			permissions: ["transfer"],
		};
		const envelope = signedEnvelope(result);
		const caps = createRelayCapabilities();
		const session = { ...relayUrls(caps), registered: true as const } as Awaited<ReturnType<typeof prepareRelaySession>>;
		const requestHash = envelope.payload.request_hash;
		const milestones: string[] = [];
		const calls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			calls.push(url);
			if (url === session.streamUrl) {
				return Promise.resolve(new Response(sseStream([sseEvent(JSON.stringify({ status: "timeout" }), "timeout")]), { headers: { "Content-Type": "text/event-stream" } }));
			}
			return Promise.resolve(new Response(JSON.stringify(envelope), { headers: { "Content-Type": "application/json" } }));
		}) as typeof fetch;

		await expect(subscribeViaRelayV2(request, session, {
			requestHash,
			streamTimeoutMs: 100,
			pollTimeoutMs: 100,
			pollIntervalMs: 0,
			maxPollAttempts: 2,
			onEvent: (event) => milestones.push(event.milestone),
			verification: { verifySignature: () => true },
		})).resolves.toEqual(result);
		expect(milestones).toEqual([
			"session_registered",
			"stream_open_started",
			"stream_opened",
			"awaiting_approval",
			"result_recovered_via_poll",
			"callback_verified",
		]);
		expect(calls).toEqual([session.streamUrl, session.resultUrl]);
	});

	test("bounded polling reports pending without relaunching the nonce", async () => {
		const request = createConnectRequest({ type: "connect", dapp: { origin: "https://demo.app" } });
		const caps = createRelayCapabilities();
		const session = { ...relayUrls(caps), registered: true as const } as Awaited<ReturnType<typeof prepareRelaySession>>;
		const events: Array<{ milestone: string; snapshot: unknown }> = [];
		const calls: string[] = [];
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			calls.push(url);
			if (url === session.streamUrl) return Promise.resolve(new Response(sseStream([sseEvent("{}", "timeout")]), { headers: { "Content-Type": "text/event-stream" } }));
			return Promise.resolve(new Response(JSON.stringify({ status: "pending" }), { headers: { "Content-Type": "application/json" } }));
		}) as typeof fetch;

		const error = await subscribeViaRelayV2(request, session, {
			pollTimeoutMs: 100,
			pollIntervalMs: 0,
			maxPollAttempts: 2,
			onEvent: (event) => events.push({ milestone: event.milestone, snapshot: event.snapshot }),
		}).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(GlyphRelayError);
		expect((error as GlyphRelayError).code).toBe("result_pending");
		expect(events.map((event) => event.milestone)).toEqual([
			"session_registered",
			"stream_open_started",
			"stream_opened",
			"awaiting_approval",
			"timed_out_pending",
			"failed",
		]);
		expect(calls).toEqual([session.streamUrl, session.resultUrl, session.resultUrl]);
	});

	test("retries transient stream and result failures before polling recovery succeeds", async () => {
		const request = createConnectRequest({ type: "connect", dapp: { origin: "https://demo.app" } });
		const result: GlyphCallbackResponse = { status: "rejected", type: "connect", nonce: request.nonce, reason: "user_rejected" };
		const caps = createRelayCapabilities();
		const session = { ...relayUrls(caps), registered: true as const } as Awaited<ReturnType<typeof prepareRelaySession>>;
		let resultCalls = 0;
		globalThis.fetch = ((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === session.streamUrl) return Promise.reject(new TypeError("network failure with secret-like details"));
			resultCalls++;
			if (resultCalls === 1) return Promise.resolve(new Response("", { status: 503 }));
			return Promise.resolve(new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } }));
		}) as typeof fetch;

		await expect(subscribeViaRelayV2(request, session, {
			pollTimeoutMs: 100,
			pollIntervalMs: 0,
			maxPollAttempts: 3,
		})).resolves.toEqual(result);
		expect(resultCalls).toBe(2);
	});

	test("support IDs and diagnostics errors are deterministic and capability-free", async () => {
		const requestHash = "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
		const supportId = deriveGlyphSupportId(requestHash);
		expect(supportId).toBe(deriveGlyphSupportId(requestHash));
		expect(supportId).toMatch(/^[A-Za-z0-9_-]{16}$/);
		const caps = createRelayCapabilities();
		const session = { ...relayUrls(caps), registered: true as const } as Awaited<ReturnType<typeof prepareRelaySession>>;
		const request = createConnectRequest({ type: "connect", dapp: { origin: "https://demo.app" } });
		globalThis.fetch = ((input: RequestInfo | URL) => {
			if (String(input) === session.streamUrl) return Promise.resolve(new Response(sseStream([sseEvent("{}", "timeout")]), { headers: { "Content-Type": "text/event-stream" } }));
			return Promise.resolve(new Response(JSON.stringify({ pending: true }), { headers: { "Content-Type": "application/json" } }));
		}) as typeof fetch;
		let seenEvent: unknown;
		const error = await subscribeViaRelayV2(request, session, {
			requestHash,
			pollTimeoutMs: 20,
			pollIntervalMs: 0,
			maxPollAttempts: 1,
			onEvent: (event) => { seenEvent = event; },
		}).catch((cause: unknown) => cause);
		const serialized = JSON.stringify({ event: seenEvent, error });
		for (const secret of [caps.session, caps.callbackCap, caps.readCap, session.callbackUrl, request.nonce]) {
			expect(serialized).not.toContain(secret);
		}
		expect(serialized).toContain(supportId);
		expect(serialized).not.toContain("identity");
		expect(serialized).not.toContain("https://demo.app");
	});
});
