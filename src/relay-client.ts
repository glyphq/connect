import { parseCallbackResponse, type GlyphCallbackResponse, type GlyphRequestStatus } from "./index";

// ── Types ──────────────────────────────────────────────────────────────────

export const DEFAULT_RELAY_URL = "https://relay.glyphq.org";

export interface GlyphRelayOptions {
  /** Base URL of the Glyph relay server. Defaults to https://relay.glyphq.org */
  relayUrl?: string;
  /** Timeout in ms before the SSE stream rejects. Defaults to 300 000 (5 min). */
  timeoutMs?: number;
  /** Receives transport-level progress for rendering request feedback. */
  onStatus?: (status: GlyphRequestStatus) => void;
}

// ── SSE parser ─────────────────────────────────────────────────────────────

/**
 * Parse an SSE stream from a fetch response body reader.
 * Yields `{ event, data }` for each complete SSE message.
 */
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // Keep the last potentially-incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line === "") {
          // Empty line = end of message
          if (currentData || currentEvent) {
            yield { event: currentEvent || "message", data: currentData };
            currentEvent = "";
            currentData = "";
          }
        }
      }
    }
    // Flush remaining buffer
    if (currentData || currentEvent) {
      yield { event: currentEvent || "message", data: currentData };
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Relay client ───────────────────────────────────────────────────────────

/**
 * Subscribe to a relay SSE stream and return the result as a Promise.
 *
 * Opens a streaming `fetch()` to `GET /v1/stream/:nonce` on the relay.
 * The connection stays open until the wallet POSTs the result or the
 * timeout fires.
 *
 * Works in browsers, Node 18+, Bun, Deno, and service workers.
 *
 * @example
 * const nonce = createNonce();
 * const stream = subscribeViaRelay(nonce, { relayUrl: "https://relay.glyphq.org" });
 * launchGlyphRequest(envelope);
 * const result = await stream;
 */
export function subscribeViaRelay(
  nonce: string,
  options: GlyphRelayOptions = {},
): Promise<GlyphCallbackResponse> {
  const relayUrl = (options.relayUrl ?? DEFAULT_RELAY_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;

  return new Promise<GlyphCallbackResponse>((resolve, reject) => {
    let settled = false;
    let abort: AbortController | undefined;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        abort?.abort();
        const error = new Error("Relay stream timed out");
        options.onStatus?.({ state: "failed", error });
        reject(error);
      }
    }, timeoutMs);

    options.onStatus?.({ state: "opening_wallet" });

    abort = new AbortController();

    fetch(`${relayUrl}/v1/stream/${nonce}`, {
      signal: abort.signal,
      headers: { Accept: "text/event-stream" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Relay returned ${response.status}`);
        }
        if (!response.body) {
          throw new Error("Relay returned no body");
        }

        options.onStatus?.({ state: "awaiting_approval" });

        for await (const msg of parseSSEStream(response.body)) {
          if (settled) break;

          if (msg.event === "result") {
            try {
              const raw = JSON.parse(msg.data);
              const result = parseCallbackResponse(raw);
              settled = true;
              clearTimeout(timer);
              abort?.abort();
              options.onStatus?.({ state: "completed", result });
              resolve(result);
            } catch (err) {
              settled = true;
              clearTimeout(timer);
              abort?.abort();
              const error = err instanceof Error ? err : new Error(String(err));
              options.onStatus?.({ state: "failed", error });
              reject(error);
            }
            break;
          }

          if (msg.event === "timeout") {
            settled = true;
            clearTimeout(timer);
            abort?.abort();
            const error = new Error("Relay stream timed out");
            options.onStatus?.({ state: "failed", error });
            reject(error);
            break;
          }

          // "close" event — server signaled stream is done
          if (msg.event === "close" && !settled) {
            settled = true;
            clearTimeout(timer);
            abort?.abort();
            const error = new Error("Relay stream closed without a result");
            options.onStatus?.({ state: "failed", error });
            reject(error);
            break;
          }
        }

        // Stream ended without a result
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const error = new Error("Relay stream ended without a result");
          options.onStatus?.({ state: "failed", error });
          reject(error);
        }
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = err instanceof Error ? err : new Error(String(err));
        options.onStatus?.({ state: "failed", error });
        reject(error);
      });
  });
}

/**
 * Build the callback URL for a relay-backed Glyph request.
 *
 * Use this as the `callback` field in `createEnvelope()` so the wallet
 * POSTs the result to the relay, which then streams it to the dApp via
 * `subscribeViaRelay()`.
 *
 * @example
 * const nonce = createNonce();
 * const callbackUrl = relayCallbackUrl(nonce, "https://relay.glyphq.org");
 * const envelope = createEnvelope(request, { callback: callbackUrl });
 * const result = await subscribeViaRelay(nonce);
 */
export function relayCallbackUrl(
  nonce: string,
  relayUrl: string = DEFAULT_RELAY_URL,
): string {
  return `${relayUrl.replace(/\/+$/, "")}/v1/callback/${nonce}`;
}
