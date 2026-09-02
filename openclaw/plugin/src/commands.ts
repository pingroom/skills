import { PingRoom } from "@pingroom/sdk";
import { AGENT_LABEL, DEFAULT_BASE_URL, PLUGIN_SCOPES } from "./constants.js";
import { inspectAccount, readChannelConfig } from "./config.js";

/**
 * `/pingroom connect|status|rooms|disconnect`.
 *
 * Named `connect`, never `pair`: OpenClaw already owns `/pair` and `/pairing`
 * for DM allowlist approval, and reusing the word would collide with a core
 * command and mean something else to the user.
 */
export interface CommandContext {
  args?: string;
  senderIsOwner?: boolean;
  sessionKey?: string;
  config: unknown;
}

export interface CommandDeps {
  /** Persist an approved credential into channels.pingroom. */
  saveCredential: (credential: {
    token: string;
    defaultRoom?: string;
    handle?: string;
  }) => Promise<void>;
  /** Announce an out-of-band result into the session that ran the command. */
  notify: (text: string, sessionKey?: string) => Promise<void>;
  /** Track the in-flight pairing so a second /pingroom connect cannot start one. */
  pending: Set<string>;
  createClient?: (baseUrl: string) => PingRoom;
  now?: () => number;
}

export interface CommandReply {
  text: string;
  presentation?: unknown;
  continueAgent?: boolean;
}

export async function runCommand(ctx: CommandContext, deps: CommandDeps): Promise<CommandReply> {
  const [sub = "", ...rest] = (ctx.args ?? "").trim().split(/\s+/).filter(Boolean);
  switch (sub.toLowerCase()) {
    case "":
    case "help":
      return { text: HELP };
    case "connect":
      return connect(ctx, deps, rest);
    case "status":
      return status(ctx);
    case "rooms":
      return rooms(ctx, deps);
    case "disconnect":
      return disconnect(ctx, deps);
    default:
      return { text: `Unknown subcommand "${sub}".\n\n${HELP}` };
  }
}

const HELP = [
  "PingRoom — reach your phone from this agent.",
  "",
  "  /pingroom connect      Approve this agent on your phone (owner only)",
  "  /pingroom status       Show the current connection",
  "  /pingroom rooms        List rooms this agent may reach",
  "  /pingroom disconnect   Revoke the credential (owner only)",
].join("\n");

async function connect(ctx: CommandContext, deps: CommandDeps, args: string[]): Promise<CommandReply> {
  if (ctx.senderIsOwner === false) {
    return { text: "Only the account owner can connect PingRoom." };
  }
  const accountKey = "default";
  if (deps.pending.has(accountKey)) {
    return { text: "A PingRoom approval link is already open. Approve it, or wait for it to expire." };
  }

  const config = readChannelConfig(ctx.config);
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const label = labelFrom(args) ?? config.agentLabel ?? AGENT_LABEL;
  const sdk = deps.createClient?.(baseUrl) ?? new PingRoom({ baseUrl });

  const pairing = await sdk.auth.startPairing({
    scopes: config.scopes ?? [...PLUGIN_SCOPES],
    agent_label: label,
  });

  deps.pending.add(accountKey);
  // Detached on purpose: the approval takes as long as it takes, and the reply
  // below has to reach the human now so they have something to tap.
  void (async () => {
    try {
      const credential = await sdk.auth.waitForPairing(pairing);
      await deps.saveCredential({
        token: credential.credential,
        ...(credential.room?.invite_code ? { defaultRoom: credential.room.invite_code } : {}),
        ...(credential.handle ? { handle: credential.handle } : {}),
      });
      const where = credential.room?.name
        ? ` → #${credential.room.name}`
        : credential.room_access === "all" ? " → all rooms" : "";
      await deps.notify(`PingRoom connected as @${credential.handle ?? "agent"}${where}.`, ctx.sessionKey);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await deps.notify(
        reason.includes("pairing_expired")
          ? "The PingRoom approval link expired. Run /pingroom connect again for a fresh one."
          : `PingRoom pairing failed: ${reason}`,
        ctx.sessionKey,
      );
    } finally {
      deps.pending.delete(accountKey);
    }
  })();

  return {
    text: `Approve PingRoom access on your phone: ${pairing.pair_url}\nThe link expires in 15 minutes.`,
    presentation: {
      title: "Connect PingRoom",
      tone: "info",
      blocks: [
        { type: "text", text: "Open the link, sign in, and choose which rooms this agent may use." },
        {
          type: "buttons",
          buttons: [
            { label: "Approve in PingRoom", style: "primary", action: { type: "url", url: pairing.pair_url } },
          ],
        },
        { type: "context", text: "Expires in 15 min · nothing is stored until you approve." },
      ],
    },
  };
}

function status(ctx: CommandContext): CommandReply {
  const snapshot = inspectAccount(ctx.config);
  if (!snapshot.configured) {
    return { text: "PingRoom is not connected. Run /pingroom connect." };
  }
  const lines = [
    `PingRoom: connected (credential from ${describeSource(snapshot.tokenSource)})`,
    `  Delivery room: ${snapshot.defaultRoom ?? "not pinned — set channels.pingroom.defaultRoom"}`,
    `  API: ${snapshot.baseUrl}`,
    `  Inbound polling: ${snapshot.inboundEnabled ? "on" : "off"}`,
    `  Webhook intake: ${snapshot.webhookEnabled ? "on" : "off"}`,
    "  Free accounts get 20 agent operations per day.",
  ];
  return { text: lines.join("\n") };
}

async function rooms(ctx: CommandContext, deps: CommandDeps): Promise<CommandReply> {
  const snapshot = inspectAccount(ctx.config);
  if (!snapshot.configured) return { text: "PingRoom is not connected. Run /pingroom connect." };

  const sdk = deps.createClient?.(snapshot.baseUrl);
  if (!sdk) return { text: "PingRoom rooms are unavailable right now." };
  const list = (await sdk.rooms.list()) as Array<{ name?: string; invite_code?: string }>;
  if (!list?.length) return { text: "This agent has no rooms yet." };
  return {
    text: ["Rooms this agent may reach:", ...list.map((r) => `  ${r.name ?? "(unnamed)"} — ${r.invite_code}`)].join("\n"),
  };
}

async function disconnect(ctx: CommandContext, deps: CommandDeps): Promise<CommandReply> {
  if (ctx.senderIsOwner === false) {
    return { text: "Only the account owner can disconnect PingRoom." };
  }
  const snapshot = inspectAccount(ctx.config);
  if (!snapshot.configured) return { text: "PingRoom is not connected." };

  const sdk = deps.createClient?.(snapshot.baseUrl);
  let revoked = false;
  try {
    if (sdk) { await sdk.auth.revoke(); revoked = true; }
  } catch {
    // The local credential still goes away; a live server-side registration is
    // visible (and revocable) under Connected Agents.
  }
  await deps.saveCredential({ token: "" });
  return {
    text: revoked
      ? "PingRoom disconnected and the credential revoked."
      : "PingRoom credential cleared locally. Revoke it under Connected Agents in the app.",
  };
}

function describeSource(source: string): string {
  switch (source) {
    case "config": return "channels.pingroom.token";
    case "secret-ref": return "a SecretRef";
    case "env": return "PINGROOM_TOKEN";
    case "cli-credential": return "the paired CLI credential";
    default: return source;
  }
}

function labelFrom(args: string[]): string | undefined {
  const index = args.indexOf("--label");
  return index >= 0 ? args[index + 1] : undefined;
}
