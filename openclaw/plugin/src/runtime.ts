import type { PingRoom } from "@pingroom/sdk";
import { createClient } from "./client.js";
import { resolveAccount, type ResolvedAccount } from "./config.js";
import type { QuestionMarker } from "./inbound/questions.js";

/**
 * The live runtime for the channel object.
 *
 * A ChannelPlugin is built at module load, long before there is a config or a
 * credential, so the send adapters cannot close over an SDK client. The host
 * installs the runtime through the entry's `setRuntime`, and the adapters
 * resolve the account per call — which is also what makes a re-pair take effect
 * without reloading the plugin.
 */
export interface PingRoomRuntime {
  /** Whole OpenClaw config; the channel section is read out of it per call. */
  getConfig: () => unknown;
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  /** Overridable for tests. */
  createClientFor?: (account: ResolvedAccount) => PingRoom;
  createQuestionMarker?: (marker: QuestionMarker, room: string) => QuestionMarker;
  watchQuestion?: (questionId: string) => void;
  isApprovalActor?: (accountId: string, senderId: string) => boolean;
}

let runtime: PingRoomRuntime | null = null;

export function setPingRoomRuntime(next: PingRoomRuntime | null): void {
  runtime = next;
}

export function getPingRoomRuntime(): PingRoomRuntime {
  if (!runtime) {
    throw new Error("PingRoom channel runtime is not installed yet.");
  }
  return runtime;
}

/** Resolve the account and a client for one outbound call. */
export function currentAccount(accountId?: string | null): { account: ResolvedAccount; sdk: PingRoom } {
  const current = getPingRoomRuntime();
  const account = resolveAccount(current.getConfig(), accountId ?? "default");
  const sdk = current.createClientFor?.(account) ?? createClient(account);
  return { account, sdk };
}

/** Pro state is per-process and cheap to remember: a 402 will repeat all day. */
const proUnavailable = new Set<string>();
export function markProUnavailable(accountId: string): void { proUnavailable.add(accountId); }
export function isProUnavailable(accountId: string): boolean { return proUnavailable.has(accountId); }
export function resetProState(): void { proUnavailable.clear(); }
