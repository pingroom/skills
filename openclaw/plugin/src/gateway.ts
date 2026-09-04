import { rmSync } from "node:fs";
import { join } from "node:path";
import type { OpenClawPluginApi, OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { questionGatewayRuntime } from "openclaw/plugin-sdk/question-gateway-runtime";
import { resolveApprovalOverGateway } from "openclaw/plugin-sdk/approval-gateway-runtime";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import { inspectAccount, readChannelConfig, type ResolvedAccount } from "./config.js";
import { currentAccount } from "./runtime.js";
import { writeCliCredential } from "./credential-file.js";
import { execEnvFor } from "./hooks.js";
import { PingRoomAccountService } from "./service.js";
import { QuestionBindings } from "./inbound/bindings.js";
import { renderInboundText, type InboundNotification } from "./inbound/events.js";
import { type QuestionMarker, type QuestionResolution } from "./inbound/questions.js";
import { verifyAndNormalize } from "./inbound/webhook.js";
import { planFromPresentation } from "./outbound/render.js";
import { pingroomChannelPlugin } from "./channel.js";

// These are public channel adapters. Community plugins cannot call the
// trusted-only runtime.gateway.request surface.
export const resolutionAdapters = {
  question: questionGatewayRuntime.resolveOption,
  approval: resolveApprovalOverGateway,
};

export function registerPingRoomGateway(api: OpenClawPluginApi) {
  let service: PingRoomAccountService | undefined;
  let account: ResolvedAccount | undefined;
  let bindings: QuestionBindings | undefined;
  let stateDir: string | undefined;
  let credentialHome: string | undefined;
  let pairedHumanId: string | undefined;
  let transition = Promise.resolve();
  const origins = new Map<string, { sessionKey: string; agentId?: string }>();
  const config = () => (api.runtime.config.current?.() ?? api.config) as OpenClawConfig;

  const stop = async () => {
    const previous = service;
    service = undefined;
    account = undefined;
    pairedHumanId = undefined;
    origins.clear();
    await previous?.stop();
    if (credentialHome) rmSync(join(credentialHome, "credentials.json"), { force: true });
  };

  const start = async () => {
    await stop();
    if (!stateDir) return;
    const snapshot = inspectAccount(config());
    if (!snapshot.enabled || !snapshot.configured) return;
    const resolved = currentAccount();
    account = resolved.account;
    bindings = new QuestionBindings(join(stateDir, "pingroom"));
    credentialHome = join(stateDir, "pingroom", "cli");
    if (account.execEnv.enabled) writeCliCredential(credentialHome, {
      token: account.token,
      apiBase: account.baseUrl,
      ...(account.defaultRoom ? { room: { invite_code: account.defaultRoom } } : {}),
      ...(account.latestPingsUrl ? { links: { latest_pings: account.latestPingsUrl } } : {}),
    });
    const active = account;
    service = new PingRoomAccountService({
      account: active,
      sdk: resolved.sdk,
      log: api.logger,
      acceptsMarker: (marker) => bindings?.verify(marker, active.token) === true,
      onPing: async ({ notification }) => {
        if (active.dmPolicy === "disabled") return;
        if (active.dmPolicy === "allowlist" && (!notification.sender?.id || !active.allowFrom.includes(notification.sender.id))) return;
        await dispatch(notification, active);
      },
      onQuestionResolved: async (resolution) => resolveQuestion(resolution, active),
    });
    await service.start();
  };
  const restart = () => {
    transition = transition.catch(() => {}).then(start);
    return transition;
  };

  async function dispatch(notification: InboundNotification, active: ResolvedAccount, origin?: QuestionMarker) {
    const room = notification.room?.code;
    if (!room || !notification.sender?.id) return;
    const route = api.runtime.channel.routing.resolveAgentRoute({
      cfg: config(), channel: "pingroom", accountId: active.accountId,
      peer: { kind: "group", id: room },
    });
    if (origin?.sessionKey) {
      // This field is accepted only after its gateway/credential binding verifies.
      route.sessionKey = origin.sessionKey;
      if (origin.agentId) route.agentId = origin.agentId;
    }
    const text = renderInboundText(notification);
    const ctxPayload = api.runtime.channel.inbound.buildContext({
      channel: "pingroom", accountId: active.accountId, messageId: notification.id,
      from: `pingroom:${notification.sender.id}`,
      sender: { id: notification.sender.id, ...(notification.sender.name ? { name: notification.sender.name } : {}) },
      conversation: { kind: "group", id: room, ...(notification.room?.name ? { label: notification.room.name } : {}) },
      route: { agentId: route.agentId, routeSessionKey: route.sessionKey },
      reply: { to: room, replyToId: notification.id, sourceReplyDeliveryMode: "reply" },
      message: { rawBody: text, bodyForAgent: text },
      access: { commands: { authorized: false } },
      channelIngress: "unsupported",
    });
    await api.runtime.channel.inbound.dispatch({
      cfg: config(), channel: "pingroom", accountId: active.accountId, route, ctxPayload,
      delivery: {
        deliver: async (payload, info) => {
          if (active.visibleReplies !== "all" && info.kind !== "final") return;
          const result = await pingroomChannelPlugin.outbound!.sendPayload!({
            cfg: config(), to: room, text: payload.text ?? "", payload, accountId: active.accountId,
          });
          return { messageIds: result.messageId ? [result.messageId] : [] };
        },
      },
    });
  }

  async function resolveQuestion(resolution: QuestionResolution, active: ResolvedAccount) {
    const { marker } = resolution;
    if (!bindings?.verify(marker, active.token)) return;
    if (resolution.state !== "answered") {
      // OpenClaw owns its timeout/cancellation. Never translate either into consent.
      api.logger.info(`PingRoom ${marker.kind} ${resolution.state}; no answer submitted`);
      return;
    }
    if (resolution.responderScope !== "direct" || !resolution.targetUserId
      || resolution.responderId !== resolution.targetUserId) {
      api.logger.warn("Ignoring PingRoom answer without the bound human's verified identity");
      return;
    }
    pairedHumanId = resolution.targetUserId;
    if (marker.kind === "question" && marker.questionId) {
      if (resolution.optionValue) {
        await resolutionAdapters.question({ cfg: config(), questionId: marker.questionId,
          optionValue: resolution.optionValue, senderId: resolution.responderId });
      } else if (resolution.text && marker.room && marker.sessionKey) {
        const transition = await resolutionAdapters.question({ cfg: config(), questionId: marker.questionId,
          customInput: true, senderId: resolution.responderId });
        if (transition.status !== "custom-input") return;
        await dispatch({ id: marker.questionId, message: resolution.text,
          room: { code: marker.room }, sender: { id: resolution.responderId } }, active, marker);
      } else {
        api.logger.warn("PingRoom typed answer has no original session; answer in the originating OpenClaw chat");
      }
    } else if (marker.kind === "approval" && marker.approvalId
      && (marker.approvalKind === "exec" || marker.approvalKind === "plugin")
      && (resolution.optionValue === "allow-once" || resolution.optionValue === "allow-always" || resolution.optionValue === "deny")) {
      await resolutionAdapters.approval({ cfg: config(), approvalId: marker.approvalId,
        approvalKind: marker.approvalKind, decision: resolution.optionValue,
        channel: "pingroom", accountId: active.accountId, senderId: resolution.responderId });
    }
  }

  api.registerService({
    id: "pingroom-inbound",
    start: async (ctx) => { stateDir = ctx.stateDir; await restart(); },
    stop: async () => {
      stateDir = undefined;
      await transition.catch(() => {});
      await stop();
    },
  });
  api.on("resolve_exec_env", () => account && credentialHome ? { ...execEnvFor(account, credentialHome) } : {});
  api.on("reply_payload_sending", (event, ctx) => {
    if ((event.channel ?? ctx.channelId) !== "pingroom") return;
    const sessionKey = event.sessionKey ?? ctx.sessionKey;
    if (!sessionKey) return;
    const plan = planFromPresentation(event.payload.presentation);
    const id = plan.kind === "question" ? plan.questionId : plan.kind === "approval" ? plan.approvalId : undefined;
    if (id) {
      if (origins.size >= 1000) origins.delete(origins.keys().next().value!);
      const agentId = event.usageState?.agentId ?? parseAgentSessionKey(sessionKey)?.agentId;
      origins.set(id, { sessionKey, ...(agentId ? { agentId } : {}) });
    }
  });

  const webhook = readChannelConfig(config()).webhook;
  if (webhook?.enabled) api.registerHttpRoute({
    path: webhook.path ?? "/pingroom/events", auth: "plugin", match: "exact",
    handler: async (req, res) => {
      const end = (status: number, text: string) => { res.statusCode = status; res.end(text); };
      if (req.method !== "POST") { res.setHeader("Allow", "POST"); end(405, "method not allowed"); return; }
      const secret = readChannelConfig(config()).webhook?.secret;
      if (!service || typeof secret !== "string" || !secret) { end(503, "webhook not configured"); return; }
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > 128 * 1024) { end(413, "body too large"); return; }
          chunks.push(buffer);
        }
        const verified = await verifyAndNormalize(Buffer.concat(chunks).toString("utf8"), req.headers, secret);
        if (!verified.ok) { end(verified.status, verified.reason ?? "invalid webhook"); return; }
        if (verified.event?.type === "ping") {
          // Webhooks omit sender ids and some echo markers; the API is authoritative.
          const notification = await service.client.notifications.getNotification(verified.event.id);
          await service.ingest({ ...verified.event, notification });
        } else if (verified.event) await service.ingest(verified.event);
        end(200, "ok");
      } catch (error) {
        api.logger.warn(`PingRoom webhook failed: ${error instanceof Error ? error.message : String(error)}`);
        end(503, "delivery failed");
      }
    },
  });

  return {
    restart,
    createQuestionMarker(marker: QuestionMarker, room: string): QuestionMarker {
      if (!account || !bindings || !service) throw new Error("PingRoom inbound service is not running");
      const origin = origins.get(marker.questionId ?? marker.approvalId ?? "");
      return bindings.sign({ ...marker, room, ...origin }, account.token);
    },
    watchQuestion: (id: string) => service?.watchQuestion(id),
    isApprovalActor: (accountId: string, senderId: string) => account?.accountId === accountId && pairedHumanId === senderId,
  };
}
