import { PingRoom } from "@pingroom/sdk";
import type { ResolvedAccount } from "./config.js";

/**
 * One PingRoom SDK client per account.
 *
 * Constructed only inside the runtime (never at module import), so loading the
 * plugin entry for discovery costs nothing and touches no network.
 */
export function createClient(account: ResolvedAccount): PingRoom {
  return new PingRoom({
    token: account.token,
    baseUrl: account.baseUrl,
    userAgent: "pingroom-openclaw-plugin/0.1.0",
  });
}

/** True when the API refused because the bound account is not Pro. */
export function isProRequired(error: unknown): boolean {
  return codeOf(error) === "pro_required";
}

/** True when the free daily agent-operation quota is spent. */
export function isQuotaExhausted(error: unknown): boolean {
  return codeOf(error) === "free_limit_reached";
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown; body?: { code?: unknown } })?.code
    ?? (error as { body?: { code?: unknown } })?.body?.code;
  return typeof code === "string" ? code : undefined;
}
