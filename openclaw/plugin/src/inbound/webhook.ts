import { verifyWebhookSignature } from "@pingroom/sdk";
import { fromWebhook, type PingRoomEvent } from "./events.js";

export interface WebhookVerification {
  ok: boolean;
  status: number;
  event?: PingRoomEvent;
  reason?: string;
}

/**
 * Verify and normalize one outgoing-webhook delivery.
 *
 * The signature covers the exact bytes received, so the caller must pass the
 * raw body — re-serializing a parsed object changes key order and breaks the
 * HMAC. v2 is preferred and, when present, must verify: falling back to v1
 * there would let an attacker strip the stronger header.
 */
export async function verifyAndNormalize(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): Promise<WebhookVerification> {
  const header = (name: string): string | undefined => {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  const timestamp = header("x-pingroom-timestamp");
  const deliveryId = header("x-pingroom-delivery");
  const signature = header("x-pingroom-signature");
  const signatureV2 = header("x-pingroom-signature-v2");

  if (!timestamp || (!signature && !signatureV2)) {
    return { ok: false, status: 401, reason: "missing signature headers" };
  }

  const verified = await verifyWebhookSignature({
    payload: rawBody,
    ...(signature ? { signature } : {}),
    ...(signatureV2 ? { signatureV2 } : {}),
    timestamp,
    ...(deliveryId ? { deliveryId } : {}),
    secret,
  });
  if (!verified) return { ok: false, status: 401, reason: "signature mismatch" };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, reason: "body is not JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, status: 400, reason: "body must be an object" };
  }

  const event = fromWebhook(parsed);
  // An event this plugin does not act on is still a valid delivery: answering
  // anything but 200 would make PingRoom retry it three times for nothing.
  return event ? { ok: true, status: 200, event } : { ok: true, status: 200 };
}
