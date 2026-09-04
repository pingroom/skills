import { createChannelPluginBase, createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { CHANNEL_ID, PING_MESSAGE_MAX, QUESTION_MAX_OPTIONS, QUESTION_OPTION_LABEL_MAX, QUESTION_OPTION_VALUE_MAX } from "./constants.js";
import { inspectAccount, resolveAccount, type ResolvedAccount } from "./config.js";
import { currentAccount, getPingRoomRuntime, isProUnavailable, markProUnavailable } from "./runtime.js";
import type { QuestionMarker } from "./inbound/questions.js";
import { planFromPresentation } from "./outbound/render.js";
import { sendLink, sendQuestion, sendText } from "./outbound/send.js";
import { uploadMedia, type MediaContext } from "./outbound/media.js";
import { resolveRoomTarget } from "./outbound/target.js";

/**
 * The PingRoom channel.
 *
 * Deliberately omits `pairing`: OpenClaw's DM pairing sends a short code to an
 * unknown sender, and PingRoom has no way to DM a non-member — cross-account
 * agent pings are retired, and putting a code in a shared room shows it to
 * everyone. `resolveAccount` rejects `dmPolicy: "pairing"` with that reason
 * rather than letting it fail confusingly at delivery time.
 */
export const pingroomChannelPlugin = createChatChannelPlugin<ResolvedAccount>({
  base: createChannelPluginBase({
    id: CHANNEL_ID,
    meta: {
      id: CHANNEL_ID,
      label: "PingRoom",
      selectionLabel: "PingRoom (phone pings, Questions, approvals)",
      detailLabel: "PingRoom agent credential",
      docsPath: "/channels/pingroom",
      docsLabel: "pingroom",
      blurb: "Reach the human on their phone: pings, tappable Questions, approvals, and handoffs.",
      order: 90,
      // A Ping is plain text on a lock screen; markdown would render literally.
      markdownCapable: false,
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      reply: true,
      media: true,
      threads: false,
      reactions: false,
      edit: false,
    },
    config: {
      listAccountIds: () => ["default"],
      defaultAccountId: () => "default",
      resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
        resolveAccount(cfg, accountId),
      inspectAccount: (cfg: OpenClawConfig) => inspectAccount(cfg),
    },
    setup: {
      applyAccountConfig: ({ cfg, input }: { cfg: OpenClawConfig; input: Record<string, unknown> }) => ({
        ...cfg,
        channels: {
          ...(cfg as { channels?: Record<string, unknown> }).channels,
          [CHANNEL_ID]: {
            ...((cfg as { channels?: Record<string, unknown> }).channels?.[CHANNEL_ID] as object),
            ...input,
          },
        },
      }),
    },
  }),

  security: {
    dm: {
      channelKey: CHANNEL_ID,
      resolvePolicy: (account: ResolvedAccount) => account.dmPolicy,
      resolveAllowFrom: (account: ResolvedAccount) => account.allowFrom,
      // Room members other than the bound human are strangers until the
      // operator says otherwise; an empty allowlist means only the human's own
      // Questions and Handoffs reach the agent.
      defaultPolicy: "allowlist",
    },
  },

  threading: { topLevelReplyToMode: "first" },

  outbound: {
    // `attachedResults` is not optional in practice: createChatChannelPlugin
    // only merges `base` into a real ChannelOutboundAdapter when it is present,
    // and otherwise passes `{ base }` through verbatim — leaving every setting
    // below invisible to the runtime.
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async (params: { to?: string; text: string; accountId?: string | null; replyToId?: string | null }) => {
        const { account, sdk } = currentAccount(params.accountId);
        const target = resolveRoomTarget(params.to, account);
        if (!target.ok) throw new Error(target.error);
        const result = await sendText(params.text, {
          sdk,
          account,
          room: target.room,
          ...(params.replyToId ? { replyToId: params.replyToId } : {}),
          proUnavailable: isProUnavailable(account.accountId),
          onProUnavailable: () => markProUnavailable(account.accountId),
        });
        return { messageId: result.messageId ?? "" };
      },
      sendMedia: async (params: MediaContext & { to?: string; text: string; accountId?: string | null; replyToId?: string | null }) => {
        const { account, sdk } = currentAccount(params.accountId);
        const target = resolveRoomTarget(params.to, account);
        if (!target.ok) throw new Error(target.error);
        const send = {
          sdk, account, room: target.room,
          ...(params.replyToId ? { replyToId: params.replyToId } : {}),
          proUnavailable: isProUnavailable(account.accountId),
          onProUnavailable: () => markProUnavailable(account.accountId),
        };
        const attachmentIds = await uploadMedia(params, send);
        if (attachmentIds.length === 0) throw new Error("A PingRoom media reply requires an attachment.");
        const result = await sendText(params.text, { ...send, attachmentIds });
        return { messageId: result.messageId ?? "" };
      },
    },
    base: {
      deliveryMode: "direct",
      textChunkLimit: PING_MESSAGE_MAX,
      chunkerMode: "text",
      // Every Ping is a push AND a charge against the free tier's 20/day, so
      // only the final assistant message becomes one by default.
      preferFinalAssistantVisibleText: true,
      presentationCapabilities: {
        supported: true,
        buttons: true,
        selects: false,
        context: true,
        divider: false,
        charts: false,
        tables: false,
        limits: {
          actions: {
            maxActions: QUESTION_MAX_OPTIONS,
            maxActionsPerRow: QUESTION_MAX_OPTIONS,
            maxRows: 1,
            maxLabelLength: QUESTION_OPTION_LABEL_MAX,
            maxValueBytes: QUESTION_OPTION_VALUE_MAX,
            supportsStyles: true,
            supportsDisabled: false,
          },
          text: {
            maxLength: PING_MESSAGE_MAX,
            encoding: "characters",
            markdownDialect: "plain",
          },
        },
      },

      // Tool and block chatter is not an event worth a push — and every push is
      // also one of twenty daily operations on the free tier.
      shouldTreatDeliveredTextAsVisible: ({ kind }: { kind: string }) => {
        try {
          return currentAccount().account.visibleReplies === "all" || kind === "final";
        } catch {
          return kind === "final";
        }
      },

      /**
       * Turn a portable presentation into the PingRoom primitive that carries
       * it: a Question for a decision, a link ping for a lone URL, plain text
       * for everything else.
       */
      sendPayload: async (ctx: MediaContext & {
        to?: string;
        text?: string;
        accountId?: string | null;
        replyToId?: string | null;
        payload?: { presentation?: unknown; text?: string };
      }) => {
        const { account, sdk } = currentAccount(ctx.accountId);
        const target = resolveRoomTarget(ctx.to, account);
        if (!target.ok) throw new Error(target.error);

        const plan = planFromPresentation(ctx.payload?.presentation as never);
        const send = {
          sdk,
          account,
          room: target.room,
          ...(ctx.replyToId ? { replyToId: ctx.replyToId } : {}),
          proUnavailable: isProUnavailable(account.accountId),
          onProUnavailable: () => markProUnavailable(account.accountId),
          attachmentIds: [] as string[],
        };
        const text = ctx.text ?? ctx.payload?.text ?? "";

        if (plan.kind === "question" || plan.kind === "approval") {
          const runtime = getPingRoomRuntime();
          if (!runtime.createQuestionMarker || !runtime.watchQuestion) {
            throw new Error("PingRoom inbound service is not running; cannot deliver an interactive question");
          }
          const marker: QuestionMarker = plan.kind === "question"
            ? { plugin: "openclaw", kind: "question", questionId: plan.questionId }
            : { plugin: "openclaw", kind: "approval", approvalId: plan.approvalId, approvalKind: plan.approvalKind };
          send.attachmentIds = await uploadMedia(ctx, send);
          const result = await sendQuestion(plan, send, runtime.createQuestionMarker(marker, target.room));
          if (result.questionId) runtime.watchQuestion(result.questionId);
          return { channel: CHANNEL_ID, messageId: result.questionId ?? "" };
        }
        send.attachmentIds = await uploadMedia(ctx, send);
        if (plan.kind === "link") {
          const result = await sendLink(plan, text, send);
          return { channel: CHANNEL_ID, messageId: result.messageId ?? "" };
        }
        const result = await sendText(text, send);
        return { channel: CHANNEL_ID, messageId: result.messageId ?? "" };
      },
    },
  },
} as never);

// The composition helper only copies security/threading/outbound. Install the
// approval capability on the resulting public channel object.
pingroomChannelPlugin.approvalCapability = {
  authorizeActorAction: ({ accountId, senderId }) => {
    try {
      return { authorized: Boolean(senderId && getPingRoomRuntime().isApprovalActor?.(accountId ?? "default", senderId)) };
    } catch {
      return { authorized: false };
    }
  },
};
