import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/channel-core";
import { pingroomChannelPlugin } from "./channel.js";
import { CHANNEL_ID, PLUGIN_ID } from "./constants.js";
import { runCommand } from "./commands.js";
import type { PendingPairing } from "./commands.js";
import { inspectAccount } from "./config.js";
import { currentAccount, setPingRoomRuntime } from "./runtime.js";

/**
 * Plugin entry.
 *
 * Imports stay narrow on purpose: this module is loaded for discovery too, so
 * nothing here may construct an SDK client, open a socket, or read a secret.
 * The runtime lives behind `registerFull`.
 */
// The inferred entry type reaches into openclaw's internal chunk types, which
// a declaration file cannot name portably; the public shape is all a host
// needs, so the export is annotated rather than inferred.
const entry: { id: string; name: string; description: string } = defineChannelPluginEntry({
  id: PLUGIN_ID,
  name: "PingRoom",
  description: "Reach the human on their phone: pings, tappable Questions, approvals, and handoffs.",
  plugin: pingroomChannelPlugin as never,

  // Installed as soon as the host has a runtime, because the channel's send
  // adapters are built at module load and resolve the account per call.
  setRuntime(_runtime: unknown) {
    // The config is read through the api in registerFull; this hook only marks
    // that a runtime exists for hosts that call it before registration.
  },

  registerFull(api: OpenClawPluginApi) {
    const pending = new Map<string, Promise<PendingPairing>>();
    const mutationTails = new Map<string, Promise<void>>();
    const ownedClients = new Map<string, import("@pingroom/sdk").PingRoom>();

    setPingRoomRuntime({
      getConfig: () => api.config,
      logger: api.logger,
    });

    api.registerCommand({
      name: "pingroom",
      description: "Connect PingRoom, check the connection, list rooms, or disconnect.",
      acceptsArgs: true,
      requireAuth: true,
      // External plugins receive senderIsOwner only when they declare a
      // gateway scope. Pairing is an owner-level credential mutation, so both
      // the host and this handler fail closed when ownership is unknown.
      requiredScopes: ["operator.pairing"],
      exposeSenderIsOwner: true,
      agentPromptGuidance: [
        {
          text:
            "PingRoom reaches the user's phone. If the user is not connected, tell them to run "
            + "/pingroom connect and approve the link — do not try to pair by any other means.",
        } as never,
      ],
      handler: async (ctx: {
        args?: string;
        senderIsOwner?: boolean;
        sessionKey?: string;
        agentId?: string;
        sessionTarget?: { storePath?: string };
        channel?: string;
        channelId?: string;
        config: unknown;
      }) => {
        let conversationKind: "direct" | "group" | "channel" | undefined;
        if (ctx.sessionKey) {
          try {
            const entry = api.runtime?.agent?.session?.getSessionEntry?.({
              sessionKey: ctx.sessionKey,
              ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
              ...(ctx.sessionTarget?.storePath ? { storePath: ctx.sessionTarget.storePath } : {}),
              readConsistency: "latest",
            });
            if (entry?.chatType === "direct" || entry?.chatType === "group" || entry?.chatType === "channel") {
              conversationKind = entry.chatType;
            }
          } catch {
            // The command still has the conservative session-key fallback.
          }
        }
        const reply = await runCommand(
          {
            ...(ctx.args !== undefined ? { args: ctx.args } : {}),
            ...(ctx.senderIsOwner !== undefined ? { senderIsOwner: ctx.senderIsOwner } : {}),
            ...(ctx.sessionKey !== undefined ? { sessionKey: ctx.sessionKey } : {}),
            ...(ctx.channel !== undefined ? { channel: ctx.channel } : {}),
            ...(ctx.channelId !== undefined ? { channelId: ctx.channelId } : {}),
            ...(conversationKind ? { conversationKind } : {}),
            config: ctx.config ?? api.config,
          },
          {
            pending,
            mutationTails,
            ownedClients,
            connectedClient: () => currentAccount().sdk,
            saveCredential: async (credential) => {
              // Persisting into channels.pingroom is the host's job; without a
              // config-mutation seam we can only report it, never write it.
              api.logger.info(
                credential.token
                  ? `PingRoom paired as @${credential.handle ?? "agent"}; storing the credential`
                  : "PingRoom credential cleared",
              );
              await api.runtime?.config?.mutateConfigFile?.({
                mutate: (draft: Record<string, unknown>) => {
                  const channels = (draft.channels ??= {}) as Record<string, Record<string, unknown>>;
                  const section = (channels[CHANNEL_ID] ??= {});
                  if (credential.token) {
                    section.enabled = true;
                    section.token = credential.token;
                    if (credential.defaultRoom) section.defaultRoom = credential.defaultRoom;
                    else delete section.defaultRoom;
                    if (credential.links) section.links = credential.links;
                    else delete section.links;
                  } else {
                    delete section.token;
                    delete section.defaultRoom;
                    delete section.links;
                    section.enabled = false;
                  }
                  return draft;
                },
              } as never);
            },
            notify: async (text, sessionKey) => {
              // A system event rather than a chat message: the pairing result is
              // a fact about the environment, not something the agent said.
              await api.runtime?.system?.enqueueSystemEvent?.(text, {
                ...(sessionKey ? { sessionKey } : {}),
                contextKey: "pingroom:connect",
              } as never);
              api.logger.info(text);
            },
            onPairingQrRenderError: () => {
              api.logger.warn?.("Failed to render the PingRoom pairing QR; sending only the claim link");
            },
          },
        );
        return reply as never;
      },
    } as never);

    api.on?.("gateway_stop" as never, (async () => {
      api.logger.debug?.("PingRoom channel stopping");
    }) as never);

    const snapshot = inspectAccount(api.config);
    api.logger.info(
      snapshot.configured
        ? `PingRoom channel ready (credential from ${snapshot.tokenSource})`
        : "PingRoom channel loaded but not connected — run /pingroom connect",
    );
  },
}) as never;

export default entry;
