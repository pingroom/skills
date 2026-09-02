import { PING_MESSAGE_MAX, PING_TITLE_MAX } from "../constants.js";

export interface PingChunks {
  /** Optional headline, only when the text opened with a short standalone line. */
  title?: string;
  /** One entry per Ping to send, each within the message limit. */
  messages: string[];
  /** True when text was dropped to fit `maxChunks`. */
  truncated: boolean;
  /** Length of the original text, for `data.truncated_chars`. */
  originalLength: number;
}

/**
 * Turn an agent reply into Pings.
 *
 * A Ping is an event, not a transcript: 120 characters on a lock screen. The
 * agent does not know that, so the channel has to decide what survives. We
 * prefer breaking on sentence ends, then on words, and we cap the number of
 * Pings because every one of them is a separate push AND a separate charge
 * against the free tier's daily quota.
 */
export function splitForPing(
  text: string,
  { limit = PING_MESSAGE_MAX, maxChunks = 2 }: { limit?: number; maxChunks?: number } = {},
): PingChunks {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const originalLength = normalized.length;
  if (normalized === "") return { messages: [], truncated: false, originalLength };

  let title: string | undefined;
  let body = normalized;

  // A short opening line followed by more text reads as a headline, and the
  // title field is free — it does not consume the 120-character body.
  const firstBreak = normalized.indexOf("\n");
  if (firstBreak > 0 && firstBreak <= PING_TITLE_MAX) {
    const candidate = normalized.slice(0, firstBreak).trim();
    const rest = normalized.slice(firstBreak + 1).trim();
    if (candidate !== "" && rest !== "" && !candidate.endsWith(",")) {
      title = candidate;
      body = rest;
    }
  }

  // Collapse the remaining newlines: a lock-screen Ping renders one run of text.
  body = body.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();

  const messages: string[] = [];
  let remaining = body;
  while (remaining !== "" && messages.length < maxChunks) {
    if (remaining.length <= limit) {
      messages.push(remaining);
      remaining = "";
      break;
    }
    messages.push(takeChunk(remaining, limit));
    remaining = remaining.slice(messages[messages.length - 1].length).trim();
  }

  const truncated = remaining !== "";
  if (truncated && messages.length > 0) {
    const last = messages.length - 1;
    messages[last] = `${messages[last].slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
  }

  return { ...(title ? { title } : {}), messages, truncated, originalLength };
}

/** The longest prefix within `limit`, preferring a sentence end, then a word. */
function takeChunk(text: string, limit: number): string {
  const window = text.slice(0, limit);
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  // Only honor a sentence break past the halfway mark; otherwise a stray
  // abbreviation early in the text produces a uselessly short Ping.
  if (sentence > limit / 2) return window.slice(0, sentence + 1).trim();

  const space = window.lastIndexOf(" ");
  if (space > limit / 2) return window.slice(0, space).trim();

  return window.trim();
}
