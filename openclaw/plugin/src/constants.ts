/** Everything the rest of the plugin agrees on, in one place. */

export const CHANNEL_ID = "pingroom";
export const PLUGIN_ID = "pingroom";
export const PLUGIN_VERSION = "0.1.2";
export const USER_AGENT = `pingroom-openclaw-plugin/${PLUGIN_VERSION}`;
export const DEFAULT_BASE_URL = "https://api.pingroom.io";
export const AGENT_LABEL = "OpenClaw";
/** Token-free smart install handoff shared by every agent-facing surface. */
export const INSTALL_APP_URL = "https://pingroom.io/i";

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
/** Attachment limits accepted by the PingRoom API. */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 4;

/** Reserved outbound targets that mean "the room the human pinned at pairing". */
export const DELIVERY_ROOM_ALIASES = new Set(["me", "default", "owner"]);

/** A PingRoom invite code as it appears in a `to` field. */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{4,12}$/;
