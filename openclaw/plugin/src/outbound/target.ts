import { DELIVERY_ROOM_ALIASES, INVITE_CODE_PATTERN } from "../constants.js";
import type { ResolvedAccount } from "../config.js";

/**
 * Turn an outbound `to` into a PingRoom room invite code.
 *
 * Accepts a bare invite code, a `pingroom:` prefixed one, or one of the
 * reserved aliases meaning "the delivery room the human pinned when they
 * approved this agent".
 */
export function resolveRoomTarget(
  to: string | null | undefined,
  account: ResolvedAccount,
): { ok: true; room: string } | { ok: false; error: string } {
  const raw = (to ?? "").trim();
  const stripped = raw.toLowerCase().startsWith("pingroom:") ? raw.slice("pingroom:".length) : raw;

  if (stripped === "" || DELIVERY_ROOM_ALIASES.has(stripped.toLowerCase())) {
    if (account.defaultRoom) return { ok: true, room: account.defaultRoom };
    return {
      ok: false,
      error:
        "No delivery room. Approve one under Connected Agents in the PingRoom app, "
        + "or set channels.pingroom.defaultRoom to a room invite code.",
    };
  }

  if (!INVITE_CODE_PATTERN.test(stripped)) {
    return { ok: false, error: `"${raw}" is not a PingRoom room invite code.` };
  }
  return { ok: true, room: stripped };
}

/** Is this target the human's own delivery room (a DM) rather than a shared room? */
export function isDeliveryRoom(room: string, account: ResolvedAccount): boolean {
  return Boolean(account.defaultRoom) && room === account.defaultRoom;
}
