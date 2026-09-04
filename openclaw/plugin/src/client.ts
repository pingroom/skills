import { PingRoom } from "@pingroom/sdk";
import type { ResolvedAccount } from "./config.js";
import { USER_AGENT } from "./constants.js";

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
    userAgent: USER_AGENT,
    // Enforce this even with an older installed SDK: redirecting a POST can
    // disclose its body after fetch removes cross-origin Authorization.
    fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
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
