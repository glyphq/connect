import { afterEach, describe, expect, test } from "bun:test";
import { type GlyphCallbackResponse, canonicalJson, createConnectRequest, parseOrVerifyCallback, sha256CanonicalJson, verifyCallbackEnvelope } from "./index";
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
		version: 2 as const,
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

	test("verifyCallbackEnvelope requires numeric v2 payload version", async () => {
		const result: GlyphCallbackResponse = { status: "connected", type: "connect", nonce: validNonce("payload-version"), identity: "AAAA", permissions: ["transfer"] };
		await expect(verifyCallbackEnvelope(signedEnvelope(result, { version: "glyph-connect-callback-envelope/2" }), { verifySignature: () => true })).rejects.toThrow("payload version is invalid");
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
});
