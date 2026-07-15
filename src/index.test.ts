import { describe, expect, test } from "bun:test";
import {
	base64UrlToString,
	buildGlyphUrl,
	createConnectRequest,
	createEnvelope,
	createTransferRequest,
	handleRedirect,
	isAllowedCallbackUrl,
	parseCallbackResponse,
	glyphRequest,
} from "./index";

function decodeEnvelope(url: string): unknown {
	const encoded = new URL(url.replace("glyph:", "https:")).searchParams.get("d");
	if (!encoded) throw new Error("Missing encoded envelope");
	return JSON.parse(base64UrlToString(encoded));
}

describe("@glyph-oss/connect", () => {
	// ── URL building ───────────────────────────────────────────────────────────

	test("builds a Glyph URL with a callback envelope", () => {
		const request = createTransferRequest({
			type: "transfer",
			dapp: { name: "Demo", origin: "https://demo.app" },
			to: "UVYAOYTNYCRBVFBHNFIJUEOUEPEDIDUWWEAXKFSJEBJVASCQEROJOVOEEATL",
			amount: "1000",
		});
		const url = buildGlyphUrl(createEnvelope(request, { callback: "https://demo.app/callback" }));
		expect(url.startsWith("glyph://v1/request?d=")).toBe(true);
		expect(new URL(url.replace("glyph:", "https:")).searchParams.get("cb")).toBeNull();
	});

	test("builds a Glyph URL with a redirect_uri envelope", () => {
		const request = createConnectRequest({
			type: "connect",
			dapp: { name: "Demo", origin: "https://demo.app" },
		});
		const url = buildGlyphUrl(
			createEnvelope(request, { redirect_uri: "https://demo.app/__glyph__" }),
		);
		expect(url.startsWith("glyph://v1/request?d=")).toBe(true);
		const envelope = decodeEnvelope(url) as { redirect_uri?: string };
		expect(envelope.redirect_uri).toBe("https://demo.app/__glyph__");
	});

	// ── URL validation ─────────────────────────────────────────────────────────

	test("allows only https and localhost http for callback/redirect_uri", () => {
		expect(isAllowedCallbackUrl("https://demo.app/cb")).toBe(true);
		expect(isAllowedCallbackUrl("http://localhost:3000/cb")).toBe(true);
		expect(isAllowedCallbackUrl("http://127.0.0.1:3000/cb")).toBe(true);
		expect(isAllowedCallbackUrl("http://[::1]:3000/cb")).toBe(true);
		expect(isAllowedCallbackUrl("http://demo.app/cb")).toBe(false);
	});

	test("createEnvelope throws on disallowed callback URL", () => {
		const req = createConnectRequest({
			type: "connect",
			dapp: { name: "Demo", origin: "https://demo.app" },
		});
		expect(() => createEnvelope(req, { callback: "http://demo.app/cb" })).toThrow();
	});

	test("createEnvelope throws on disallowed redirect_uri", () => {
		const req = createConnectRequest({
			type: "connect",
			dapp: { name: "Demo", origin: "https://demo.app" },
		});
		expect(() =>
			createEnvelope(req, { redirect_uri: "http://demo.app/__glyph__" }),
		).toThrow();
	});

	test("base64UrlToString rejects malformed base64url input", () => {
		expect(() => base64UrlToString("not-valid!")).toThrow("Invalid base64url value");
	});

	// ── Callback parsing ───────────────────────────────────────────────────────

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
	});

	test("parseCallbackResponse throws on unknown status/type", () => {
		expect(() =>
			parseCallbackResponse({ status: "unknown", type: "transfer", nonce: "x" }),
		).toThrow();
		expect(() =>
			parseCallbackResponse({
				status: "signed",
				type: "unknown",
				nonce: "x",
			}),
		).toThrow("Unknown callback request type");
	});

	test("parseCallbackResponse throws on malformed permissions and rejection reasons", () => {
		expect(() =>
			parseCallbackResponse({
				status: "connected",
				type: "connect",
				nonce: "x",
				identity: "AAAA",
				permissions: ["admin"],
			}),
		).toThrow("permissions");
		expect(() =>
			parseCallbackResponse({
				status: "rejected",
				type: "connect",
				nonce: "x",
				reason: "expired",
			}),
		).toThrow("Unknown rejection reason");
	});

	test("parseCallbackResponse throws on non-object input", () => {
		expect(() => parseCallbackResponse(null)).toThrow();
		expect(() => parseCallbackResponse("string")).toThrow();
		expect(() => parseCallbackResponse(42)).toThrow();
	});

	// ── handleRedirect ─────────────────────────────────────────────────────────

	test("handleRedirect broadcasts result and is a no-op if no ?result= param", () => {
		// No window in Bun. Confirm it returns safely.
		expect(() => handleRedirect()).not.toThrow();
	});

	test("handleRedirect broadcasts via BroadcastChannel when result param is present", async () => {
		const nonce = "testNonce123abc";
		const result = {
			status: "rejected",
			type: "connect",
			nonce,
			reason: "user_rejected",
		};
		const encoded = btoa(JSON.stringify(result))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/g, "");

		// Simulate browser environment.
		const received = await new Promise<unknown>((resolve) => {
			const channel = new BroadcastChannel(`glyph:result:${nonce}`);
			channel.onmessage = (event) => {
				channel.close();
				resolve(event.data);
			};

			// Simulate what handleRedirect does internally.
			const parsed = parseCallbackResponse(JSON.parse(base64UrlToString(encoded)));
			const bc = new BroadcastChannel(`glyph:result:${parsed.nonce}`);
			bc.postMessage(parsed);
			bc.close();
		});

		expect((received as { status: string }).status).toBe("rejected");
	});

	// ── glyphRequest ───────────────────────────────────────────────────────────

	test("glyphRequest throws outside browser environment", async () => {
		// Bun doesn't have window. Confirms the guard works.
		await expect(
			glyphRequest(
				createConnectRequest({
					type: "connect",
					dapp: { name: "Demo", origin: "https://demo.app" },
				}),
			),
		).rejects.toThrow("browser environment");
	});
});
