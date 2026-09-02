/** Everything the rest of the plugin agrees on, in one place. */

export const CHANNEL_ID = "pingroom";
export const PLUGIN_ID = "pingroom";
export const DEFAULT_BASE_URL = "https://api.pingroom.io";
export const AGENT_LABEL = "OpenClaw";

/**
 * PingRoom Ping limits, mirrored from the API's own validation so a reply is
 * shaped correctly before the request rather than after a 422.
 * A private room caps the body at 120 characters; public rooms allow 160, and
 * we use the stricter one because the channel does not know the room's kind
 * until it resolves one.
 */
export const PING_MESSAGE_MAX = 120;
export const PING_TITLE_MAX = 40;
export const QUESTION_CONTEXT_MAX = 40;
export const QUESTION_OPTION_LABEL_MAX = 40;
export const QUESTION_OPTION_VALUE_MAX = 40;
/** A PingRoom Question carries 2–4 options. */
export const QUESTION_MIN_OPTIONS = 2;
export const QUESTION_MAX_OPTIONS = 4;

/**
 * The scopes `/pingroom connect` asks the human to approve.
 *
 * This is a hard ceiling, exactly like the CLI's list: consent is an
 * intersection server-side, so a scope missing here can never be granted later
 * without re-connecting. It is deliberately narrower than the CLI's 16 — this
 * plugin never manages webhooks or quick actions.
 */
export const PLUGIN_SCOPES = [
  "pingroom:rooms:read",
  "pingroom:broadcast:send",
  "pingroom:attachments:write",
  "pingroom:notifications:read",
  "pingroom:questions:ask",
  "pingroom:handoffs:create",
  "pingroom:live:write",
] as const;

/** Reserved outbound targets that mean "the room the human pinned at pairing". */
export const DELIVERY_ROOM_ALIASES = new Set(["me", "default", "owner"]);

/** A PingRoom invite code as it appears in a `to` field. */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{4,12}$/;
