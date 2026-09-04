import type { PingRoom } from "@pingroom/sdk";
import type { ResolvedAccount } from "../config.js";
import { isProRequired } from "../client.js";
import { splitForPing } from "./chunk.js";
import type { PingPlan } from "./render.js";
import { PING_TITLE_MAX } from "../constants.js";
import type { QuestionMarker } from "../inbound/questions.js";

export interface SendContext {
  sdk: PingRoom;
  account: ResolvedAccount;
  room: string;
  replyToId?: string | null;
  correlationId?: string;
  /** Set when this account has already been told it is not Pro. */
  proUnavailable?: boolean;
  onProUnavailable?: () => void;
}

export interface SendResult {
  messageId?: string;
  /** PingRoom question id, when the send created a Question. */
  questionId?: string;
}

/**
 * Send agent text as one or more Pings.
 *
 * Overflow has two strategies: attach the full reply as a file (Pro only), or
 * truncate with a marker. Truncation is the default because attachments are
 * Pro-gated and a silent 402 mid-reply is worse than a visible ellipsis.
 */
export async function sendText(text: string, ctx: SendContext): Promise<SendResult> {
  const chunks = splitForPing(text, {
    maxChunks: ctx.account.maxChunksPerReply,
  });
  if (chunks.messages.length === 0) return {};

  let attachmentIds: string[] | undefined;
  if (chunks.truncated && ctx.account.overflow === "attach" && !ctx.proUnavailable) {
    attachmentIds = await tryAttachFullText(text, ctx);
  }

  let firstId: string | undefined;
  for (const [index, message] of chunks.messages.entries()) {
    const first = index === 0;
    const ping: Record<string, unknown> = { message };
    if (first && chunks.title) ping.title = chunks.title.slice(0, PING_TITLE_MAX);
    if (first && ctx.account.urgency === "urgent") ping.is_urgent = true;
    if (first && ctx.account.requireAck) ping.requires_ack = true;
    if (first && attachmentIds?.length) ping.attachment_ids = attachmentIds;
    if (ctx.correlationId) ping.correlation_id = ctx.correlationId;
    if (first && ctx.replyToId) ping.reply_to = ctx.replyToId;
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
    const uploaded = (await ctx.sdk.attachments.upload({
      filename: "reply.md",
      content: Buffer.from(text, "utf8"),
      mime_type: "text/markdown",
    } as never)) as { id?: string };
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
    ...(ctx.correlationId ? { correlation_id: ctx.correlationId } : {}),
    data: {
      url: plan.url,
      ...(plan.buttonLabel ? { button_label: plan.buttonLabel.slice(0, 26) } : {}),
    },
  } as never)) as { id?: string };
  return sent?.id ? { messageId: sent.id } : {};
}
