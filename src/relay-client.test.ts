import { afterEach, describe, expect, test } from "bun:test";
import { type GlyphCallbackResponse, createConnectRequest } from "./index";
import { parseSSEStream, relayCallbackUrl, subscribeViaRelay } from "./relay-client";

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
	test("relayCallbackUrl builds the official callback path and encodes the nonce segment", () => {
		const nonce = validNonce("abc");
		expect(relayCallbackUrl(nonce, "https://relay.glyphq.org/")).toBe(
			`https://relay.glyphq.org/v1/callback/${nonce}`,
		);
		expect(() => relayCallbackUrl("short")).toThrow("relay nonce");
		expect(() => relayCallbackUrl(validNonce(), "http://localhost:3000")).toThrow(
			"relayUrl must be exactly https://relay.glyphq.org",
		);
	});

	test("subscribeViaRelay fetches only the official relay stream with an encoded nonce", async () => {
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
		mockFetchWithSse([sseEvent(JSON.stringify(result), "result")], (url, init) => {
			expect(url).toBe(`https://relay.glyphq.org/v1/stream/${request.nonce}`);
			expect((init?.headers as Record<string, string>).Accept).toBe("text/event-stream");
		});

		await expect(subscribeViaRelay(request, { timeoutMs: 2_000 })).resolves.toEqual(result);
	});

	test("subscribeViaRelay rejects malformed or mismatched relay results", async () => {
		const nonce = validNonce("mismatch");
		mockFetchWithSse([
			sseEvent(
				JSON.stringify({
					status: "connected",
					type: "connect",
					nonce: `${nonce}other`,
					identity: "AAAA",
					permissions: ["transfer"],
				}),
				"result",
			),
		]);
		await expect(
			subscribeViaRelay({ nonce, type: "connect" }, { timeoutMs: 2_000 }),
		).rejects.toThrow("expected request nonce");

		mockFetchWithSse([
			sseEvent(
				JSON.stringify({
					status: "signed",
					type: "sign_message",
					nonce,
					identity: "AAAA",
					signature: "sig",
					public_key: "pk",
				}),
				"result",
			),
		]);
		await expect(
			subscribeViaRelay({ nonce, type: "connect" }, { timeoutMs: 2_000 }),
		).rejects.toThrow("expected request type");
	});

	test("subscribeViaRelay requires expectedType when subscribing by nonce string", () => {
		expect(() => subscribeViaRelay(validNonce(), { timeoutMs: 10 })).toThrow("expectedType");
	});

	test("subscribeViaRelay calls onStatus with progress events", async () => {
		const nonce = validNonce("status");
		const statuses: string[] = [];
		const result: GlyphCallbackResponse = {
			status: "rejected",
			type: "connect",
			nonce,
			reason: "user_rejected",
		};
		mockFetchWithSse([sseEvent(JSON.stringify(result), "result")]);

		await subscribeViaRelay(
			{ nonce, type: "connect" },
			{ timeoutMs: 2_000, onStatus: (s) => statuses.push(s.state) },
		);
		expect(statuses).toContain("opening_wallet");
		expect(statuses).toContain("awaiting_approval");
		expect(statuses).toContain("completed");
	});

	test("subscribeViaRelay rejects on relay timeout event", async () => {
		const nonce = validNonce("timeout");
		mockFetchWithSse([sseEvent(JSON.stringify({ status: "timeout" }), "timeout")]);
		await expect(
			subscribeViaRelay({ nonce, type: "connect" }, { timeoutMs: 2_000 }),
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

	test("subscribeViaRelay resolves a result event when CRLF is split across chunks", async () => {
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

		await expect(subscribeViaRelay(request, { timeoutMs: 2_000 })).resolves.toEqual(result);
	});
});
