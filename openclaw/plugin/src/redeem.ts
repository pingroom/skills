import type { PingRoom, RedeemCodeResult } from "@pingroom/sdk";
import { PingRoomError } from "@pingroom/sdk";

function redactCode(text: string, code: string): string {
  const value = code.trim();
  if (!value) return text;
  return text.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted]");
}

/** Confirm the entitlement and discard unexpected response fields before displaying it. */
export async function redeemCode(sdk: PingRoom, code: string): Promise<RedeemCodeResult> {
  const result = await sdk.redeemCode(code);
  if (
    !result || typeof result !== "object"
    || (result.kind !== "gift" && result.kind !== "redeem")
    || typeof result.message !== "string"
    || (result.reward_days !== null && (!Number.isSafeInteger(result.reward_days) || result.reward_days <= 0))
    || (result.package !== null && typeof result.package !== "string")
    || typeof result.lifetime !== "boolean"
    || result.plan !== "pro"
    || (result.lifetime
      ? result.plan_expires_at !== null
      : typeof result.plan_expires_at !== "string"
        || !/^\d{4}-\d{2}-\d{2}T/.test(result.plan_expires_at)
        || !Number.isFinite(Date.parse(result.plan_expires_at)))
  ) {
    throw new PingRoomError("No valid redemption receipt was returned.", { code: "redemption_unconfirmed" });
  }
  return {
    message: redemptionSuccessText(result),
    kind: result.kind,
    reward_days: result.reward_days,
    package: result.package === null ? null : redactCode(result.package, code),
    lifetime: result.lifetime,
    plan: result.plan,
    plan_expires_at: result.plan_expires_at,
  };
}

/** Never include the one-use code in a reply, even if an upstream error echoes it. */
export function redemptionFailureText(error: unknown, code: string): string {
  const errorCode = (error as { code?: unknown })?.code;
  if (errorCode === "insufficient_scope") {
    return "This PingRoom connection needs permission to redeem codes. Run /pingroom connect to authorize it again, then retry.";
  }
  if (errorCode === "redemption_unconfirmed") {
    return "PingRoom did not return a valid redemption receipt. Check your Pro status in the app before trying again.";
  }
  const body = (error as { body?: { errors?: { code?: unknown } } })?.body;
  const validation = body?.errors?.code;
  const message = Array.isArray(validation) && typeof validation[0] === "string"
    ? validation[0]
    : error instanceof Error ? error.message : "The request failed.";
  return `PingRoom code redemption failed: ${redactCode(message, code)}`;
}

export function redemptionSuccessText(result: RedeemCodeResult): string {
  return result.lifetime
    ? "Code redeemed. Your connected PingRoom account now has lifetime Pro."
    : `Code redeemed. Your connected PingRoom account has Pro until ${result.plan_expires_at}.`;
}

interface RedeemToolContext {
  senderIsOwner?: boolean;
  isPrivate: boolean;
}

interface RedeemToolDeps {
  connectedClient: () => PingRoom;
  isConnected: () => boolean;
}

/** The host supplies identity and privacy; neither is accepted from tool arguments. */
export function createRedeemCodeTool(ctx: RedeemToolContext, deps: RedeemToolDeps) {
  if (ctx.senderIsOwner !== true || !ctx.isPrivate) return null;
  return {
    name: "pingroom_redeem_code",
    label: "Redeem PingRoom code",
    description: "Redeem a user-provided PingRoom gift or promotional code for the human who authorized this connection. Use only when the user asks to redeem it. No room or Pro plan is required; never send the code to a room or repeat it in the reply.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["code"],
      properties: {
        code: { type: "string", description: "12 letters or digits; surrounding whitespace and letter case are normalized." },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      if (!deps.isConnected()) {
        return { isError: true, content: [{ type: "text", text: "PingRoom is not connected. Run /pingroom connect." }] };
      }
      const code = typeof params.code === "string" ? params.code : "";
      try {
        const result = await redeemCode(deps.connectedClient(), code);
        return { content: [{ type: "text", text: redemptionSuccessText(result) }], details: result };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: redemptionFailureText(error, code) }] };
      }
    },
  };
}
