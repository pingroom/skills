import type { PingRoom } from "@pingroom/sdk";
import type { ResolvedAccount } from "../config.js";
import { isProRequired } from "../client.js";
import { splitForPing } from "./chunk.js";
import type { PingPlan } from "./render.js";
import { ATTACHMENT_MAX_COUNT, PING_TITLE_MAX } from "../constants.js";
import type { QuestionMarker } from "../inbound/questions.js";

export interface SendContext {
  sdk: PingRoom;
  account: ResolvedAccount;
  room: string;
  replyToId?: string | null;
  correlationId?: string;
  attachmentIds?: string[];
  /** Set when this account has already been told it is not Pro. */
  proUnavailable?: boolean;
  onProUnavailable?: () => void;
}

export interface SendResult {
  messageId?: string;
  /** PingRoom question id, when the send created a Question. */
  questionId?: string;
}

/** Apply the same delivery preferences to text, media, and URL-button Pings. */
function broadcastMetadata(ctx: SendContext, first = true): Record<string, unknown> {
  return {
    ...(ctx.correlationId ? { correlation_id: ctx.correlationId } : {}),
    ...(first && ctx.account.urgency === "urgent" ? { is_urgent: true } : {}),
    ...(first && ctx.account.requireAck ? { requires_ack: true } : {}),
    ...(first && ctx.replyToId ? { reply_to: ctx.replyToId } : {}),
    ...(first && ctx.attachmentIds?.length ? { attachment_ids: ctx.attachmentIds } : {}),
  };
}

/**
 * Send agent text as one or more Pings.
 *
 * Overflow has two strategies: attach the full reply as a file (Pro only), or
 * truncate with a marker. Truncation is the default because attachments are
 * Pro-gated and a silent 402 mid-reply is worse than a visible ellipsis.
 */
export async function sendText(text: string, ctx: SendContext): Promise<SendResult> {
  const chunks = splitForPing(text.trim() || (ctx.attachmentIds?.length ? "Attachment" : ""), {
    maxChunks: ctx.account.maxChunksPerReply,
  });
  if (chunks.messages.length === 0) return {};

  const attachmentIds = [...(ctx.attachmentIds ?? [])];
  if (chunks.truncated && ctx.account.overflow === "attach" && !ctx.proUnavailable
    && attachmentIds.length < ATTACHMENT_MAX_COUNT) {
    attachmentIds.push(...(await tryAttachFullText(text, ctx) ?? []));
  }

  let firstId: string | undefined;
  for (const [index, message] of chunks.messages.entries()) {
    const first = index === 0;
    const ping: Record<string, unknown> = { message, ...broadcastMetadata({ ...ctx, attachmentIds }, first) };
    if (first && chunks.title) ping.title = chunks.title.slice(0, PING_TITLE_MAX);
    if (chunks.truncated && index === chunks.messages.length - 1) {
      ping.data = { truncated: true, truncated_chars: chunks.originalLength };
    }

    const sent = (await ctx.sdk.broadcast(ctx.room, ping as never)) as { id?: string };
    if (first) firstId = sent?.id;
  }

  return firstId ? { messageId: firstId } : {};
}

async function tryAttachFullText(text: string, ctx: SendContext): Promise<string[] | undefined> {
  try {
    const uploaded = await ctx.sdk.attachments.upload({
      filename: "reply.md",
      content: Buffer.from(text, "utf8"),
      contentType: "text/markdown",
    });
    return uploaded?.id ? [uploaded.id] : undefined;
  } catch (error) {
    // Not Pro: remember it so the next reply does not pay the round trip, and
    // fall through to truncation rather than failing the send.
    if (isProRequired(error)) ctx.onProUnavailable?.();
    return undefined;
  }
}

/** Send a plan that resolves to a PingRoom Question (ask_user or an approval). */
export async function sendQuestion(
  plan: Extract<PingPlan, { kind: "question" | "approval" }>,
  ctx: SendContext,
  marker: QuestionMarker,
): Promise<SendResult> {
  const created = (await ctx.sdk.questions.ask(ctx.room, {
    prompt: plan.prompt,
    options: plan.options,
    ...(plan.context ? { context: plan.context } : {}),
    ...(plan.kind === "question" && plan.allowText && marker.sessionKey
      ? { text_input: { placeholder: "Type an answer" } }
      : {}),
    ttl: ctx.account.questionTtlSeconds,
    responder_scope: "direct",
    ...(ctx.correlationId ? { correlation_id: ctx.correlationId } : {}),
    ...(ctx.replyToId ? { reply_to: ctx.replyToId } : {}),
    ...(ctx.attachmentIds?.length ? { attachment_ids: ctx.attachmentIds } : {}),
    // The mapping back to OpenClaw lives on the Question itself, so a gateway
    // restart can re-adopt open questions without a local store.
    data: { oc: marker },
  } as never)) as { id?: string };

  return created?.id ? { questionId: created.id } : {};
}

/** Send a plan that resolves to a tappable link Ping. */
export async function sendLink(
  plan: Extract<PingPlan, { kind: "link" }>,
  text: string,
  ctx: SendContext,
): Promise<SendResult> {
  const chunks = splitForPing(text, { maxChunks: 1 });
  const sent = (await ctx.sdk.broadcast(ctx.room, {
    message: chunks.messages[0] ?? plan.buttonLabel ?? "Open",
    ...(chunks.title ? { title: chunks.title } : {}),
    ...broadcastMetadata(ctx),
    data: {
      url: plan.url,
      ...(plan.buttonLabel ? { button_label: plan.buttonLabel.slice(0, 26) } : {}),
    },
  } as never)) as { id?: string };
  return sent?.id ? { messageId: sent.id } : {};
}
