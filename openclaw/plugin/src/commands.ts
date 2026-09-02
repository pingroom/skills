import { PingRoom } from "@pingroom/sdk";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import { AGENT_LABEL, DEFAULT_BASE_URL, PLUGIN_SCOPES } from "./constants.js";
import { inspectAccount, readChannelConfig } from "./config.js";

const PAIRING_QR_MAX_BYTES = 1024 * 1024;

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
  channel?: string;
  channelId?: string;
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
  /** Override used by tests; production loads OpenClaw's QR and media APIs on demand. */
  renderPairingQr?: (setupCode: string) => Promise<string>;
  onPairingQrRenderError?: () => void;
}

export interface CommandReply extends ReplyPayload {
  text: string;
  /** Marks local media as trusted in direct plugin-command replies. */
  trustedLocalMedia?: boolean;
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

  const setupCode = pairingQrUrl(pairing) ?? pairing.pair_url;
  const expiresAtMs = (deps.now?.() ?? Date.now()) + (pairing.expires_in * 1000);
  const expiresIn = formatDuration(pairing.expires_in);
  const linkReply = pairingReply(pairing.pair_url, expiresIn, false);
  const qrReply = pairingReply(pairing.pair_url, expiresIn, true);

  if (isWebChat(ctx)) {
    return {
      ...qrReply,
      // OpenClaw renders the setup code as a live QR. sensitiveMedia prevents
      // the code and generated image from being saved to history.
      channelData: {
        openclawPairingQr: { setupCode, expiresAtMs },
      },
      sensitiveMedia: true,
    };
  }

  try {
    const mediaUrl = await (deps.renderPairingQr ?? renderManagedPairingQr)(setupCode);
    return {
      ...qrReply,
      mediaUrl,
      attachments: [
        {
          type: "image",
          mediaUrl,
          mimeType: "image/png",
          name: "pingroom-pairing.png",
          trustedLocalMedia: true,
        },
      ],
      trustedLocalMedia: true,
      sensitiveMedia: true,
    };
  } catch {
    deps.onPairingQrRenderError?.();
    return linkReply;
  }
}

function pairingReply(pairUrl: string, expiresIn: string, hasQr: boolean): CommandReply {
  return {
    text: hasQr
      ? `Scan the QR with your phone, or open this approval link: ${pairUrl}\nExpires in ${expiresIn}.`
      : `Approve PingRoom access on your phone: ${pairUrl}\nThe link expires in ${expiresIn}.`,
    presentation: {
      title: "Connect PingRoom",
      tone: "info",
      blocks: [
        {
          type: "text",
          text: hasQr
            ? "Scan the QR, or open the link to sign in and choose which rooms this agent may use."
            : "Open the link, sign in, and choose which rooms this agent may use.",
        },
        {
          type: "buttons",
          buttons: [
            { label: "Approve in PingRoom", style: "primary", action: { type: "url", url: pairUrl } },
          ],
        },
        { type: "context", text: `Expires in ${expiresIn} · credentials are saved only after approval.` },
      ],
    },
  };
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Render only after a non-WebChat connect command runs. Keeping both imports
 * here prevents plugin discovery from loading the QR runtime or touching disk.
 */
async function renderManagedPairingQr(setupCode: string): Promise<string> {
  const [{ renderQrPngBase64 }, { saveMediaBuffer }] = await Promise.all([
    import("openclaw/plugin-sdk/media-runtime"),
    import("openclaw/plugin-sdk/media-store"),
  ]);
  const png = Buffer.from(await renderQrPngBase64(setupCode), "base64");
  const saved = await saveMediaBuffer(
    png,
    "image/png",
    "outbound",
    PAIRING_QR_MAX_BYTES,
    "pingroom-pairing.png",
  );
  return saved.path;
}

function pairingQrUrl(pairing: unknown): string | undefined {
  if (!pairing || typeof pairing !== "object") return undefined;
  const value = (pairing as { pair_qr_url?: unknown }).pair_qr_url;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isWebChat(ctx: CommandContext): boolean {
  return ctx.channel?.toLowerCase() === "webchat" || ctx.channelId?.toLowerCase() === "webchat";
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
