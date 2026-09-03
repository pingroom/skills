import { PingRoom } from "@pingroom/sdk";
import type { PairingStart } from "@pingroom/sdk";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import { AGENT_LABEL, DEFAULT_BASE_URL, INSTALL_APP_URL, USER_AGENT } from "./constants.js";
import { apiEndpointUrl, inspectAccount, readChannelConfig } from "./config.js";

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
  conversationKind?: "direct" | "group" | "channel";
  config: unknown;
}

export interface PendingPairing {
  pairing: RobotPairingStart;
  expiresAtMs: number;
  /** The caller-owned fallback for servers that predate robot profiles. */
  agentLabel?: string;
}

interface RobotProfile {
  display_name?: string | null;
  handle?: string | null;
  avatar_id?: string | null;
  avatar_url?: string | null;
}

interface RobotAgent {
  id?: string;
  label?: string | null;
  handle?: string | null;
  profile?: RobotProfile | null;
}

type RobotPairingStart = PairingStart & {
  flow_version?: number;
  claim_mode?: string;
  agent?: RobotAgent;
  app_install_url?: string;
  links?: { install_app?: string };
  mobile_app?: { install_url?: string };
};

interface RoomSummary {
  invite_code?: string;
  name?: string;
}

export interface CommandDeps {
  /** Persist an approved credential into channels.pingroom. */
  saveCredential: (credential: {
    token: string;
    defaultRoom?: string;
    handle?: string;
    links?: { latest_pings?: string; install_app?: string };
  }) => Promise<void>;
  /** Announce an out-of-band result into the session that ran the command. */
  notify: (text: string, sessionKey?: string) => Promise<void>;
  /** Keep the in-flight pairing so repeated commands can show the same QR/link. */
  pending: Map<string, Promise<PendingPairing>>;
  /** Serialize credential writes with disconnect for each configured account. */
  mutationTails: Map<string, Promise<void>>;
  /** Runtime clients for credentials this plugin successfully persisted. */
  ownedClients: Map<string, PingRoom>;
  createClient?: (baseUrl: string) => PingRoom;
  /** Authenticated runtime client used by commands after connection. */
  connectedClient?: () => PingRoom;
  /** Test seam; production uses startServerOwnedPairing below. */
  startPairing?: (sdk: PingRoom, baseUrl: string, agentLabel: string) => Promise<PairingStart>;
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
  const ownerOnlyMessage = OWNER_ONLY_MESSAGES[sub.toLowerCase()];
  if (ownerOnlyMessage && ctx.senderIsOwner !== true) {
    return { text: ownerOnlyMessage };
  }
  const privateOnlyMessage = PRIVATE_ONLY_MESSAGES[sub.toLowerCase()];
  if (privateOnlyMessage && !isProvenPrivateSurface(ctx)) {
    return { text: privateOnlyMessage };
  }
  switch (sub.toLowerCase()) {
    case "":
    case "help":
      return { text: HELP };
    case "connect":
      return connect(ctx, deps, rest);
    case "activate":
      return activate(ctx, deps);
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
  "PingRoom — urgent Pings, questions, approvals, handoffs, and live progress on your phone.",
  `Install or open the app and sign in first: ${INSTALL_APP_URL}`,
  "Installing the app does not claim a robot or grant it access.",
  "If delivery says recipient_not_ready: install/update, open, sign in, enable notifications, then run /pingroom activate.",
  "",
  "  /pingroom connect      Create and claim this robot on your phone (owner only)",
  "  /pingroom activate     Send a test Question to confirm your phone can answer (owner only)",
  "  /pingroom status       Show the current connection (owner only)",
  "  /pingroom rooms        List rooms this agent may reach (owner only)",
  "  /pingroom disconnect   Disconnect this channel (owner only)",
].join("\n");

const OWNER_ONLY_MESSAGES: Record<string, string> = {
  connect: "Only the account owner can connect PingRoom.",
  activate: "Only the account owner can verify the PingRoom connection.",
  status: "Only the account owner can view the PingRoom connection.",
  rooms: "Only the account owner can list PingRoom rooms.",
  disconnect: "Only the account owner can disconnect PingRoom.",
};

const PRIVATE_ONLY_MESSAGES: Record<string, string> = {
  connect: "For your security, connect PingRoom in OpenClaw WebChat or a direct-message session.",
  status: "For your security, view the PingRoom connection in OpenClaw WebChat or a direct-message session.",
  rooms: "For your security, list PingRoom rooms in OpenClaw WebChat or a direct-message session.",
};

function isProvenPrivateSurface(ctx: CommandContext): boolean {
  if (ctx.channel?.toLowerCase() === "webchat") return true;
  if (ctx.conversationKind === "direct") return true;
  if (ctx.conversationKind === "group" || ctx.conversationKind === "channel") return false;

  // Backward-compatible fallback for hosts that cannot project the persisted
  // session entry yet. A generic/main key remains unproven and fails closed.
  const sessionKey = ctx.sessionKey?.toLowerCase() ?? "";
  return sessionKey.includes(":direct:")
    && !sessionKey.includes(":group:")
    && !sessionKey.includes(":channel:");
}

async function connect(ctx: CommandContext, deps: CommandDeps, args: string[]): Promise<CommandReply> {
  const accountKey = "default";
  const existing = deps.pending.get(accountKey);
  if (existing) {
    const pending = await existing;
    if (pending.expiresAtMs > (deps.now?.() ?? Date.now())) {
      return renderPairingReply(ctx, deps, pending);
    }
    if (deps.pending.get(accountKey) === existing) deps.pending.delete(accountKey);
  }

  const config = readChannelConfig(ctx.config);
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const label = labelFrom(args) ?? config.agentLabel ?? AGENT_LABEL;
  const sdk = deps.createClient?.(baseUrl) ?? new PingRoom({ baseUrl, userAgent: USER_AGENT });
  const previous = inspectAccount(ctx.config);
  let previousOwnedClient: PingRoom | undefined;
  if (previous.enabled && previous.configured && previous.tokenSource === "config") {
    try {
      // Capture this before saving: the runtime resolver may point at the new
      // token as soon as mutateConfigFile completes.
      previousOwnedClient = deps.connectedClient?.();
    } catch {
      // Pairing can still succeed. The completion notice tells the owner if the
      // superseded credential could not be revoked automatically.
    }
  }

  // Store the promise before its first network await so simultaneous commands
  // share one ceremony and can both render the same QR/link.
  const startPromise = (async (): Promise<PendingPairing> => {
    const pairing = await (
      deps.startPairing?.(sdk, baseUrl, label)
        ?? startServerOwnedPairing(sdk, baseUrl, label)
    );
    return {
      pairing: pairing as RobotPairingStart,
      expiresAtMs: (deps.now?.() ?? Date.now()) + (pairing.expires_in * 1000),
      agentLabel: label,
    };
  })();
  deps.pending.set(accountKey, startPromise);
  let pending: PendingPairing;
  try {
    pending = await startPromise;
  } catch (error) {
    if (deps.pending.get(accountKey) === startPromise) deps.pending.delete(accountKey);
    throw error;
  }

  // Detached on purpose: the approval takes as long as it takes, and the reply
  // below has to reach the human now so they have something to tap.
  void (async () => {
    let approvedCredentialNeedsCleanup = false;
    try {
      const credential = await sdk.auth.waitForPairing(pending.pairing);
      approvedCredentialNeedsCleanup = true;

      await withConnectionMutation(deps, accountKey, async () => {
        // An expired or cancelled ceremony may finish after its replacement
        // has started. Check while holding the same lock disconnect uses, so a
        // cancellation cannot slip between this check and durable storage.
        if (deps.pending.get(accountKey) !== startPromise) {
          try { await sdk.auth.revoke(); } catch { /* best effort */ }
          approvedCredentialNeedsCleanup = false;
          return;
        }

        const links = connectionLinks(credential, baseUrl);
        const pairingIdentity = agentIdentity(
          pending.pairing,
          pending.agentLabel ?? AGENT_LABEL,
        );
        const identity = agentIdentity(credential, pairingIdentity.displayName);
        if (!identity.handle) identity.handle = pairingIdentity.handle;
        const homeRoom = connectionHomeRoom(credential);
        await deps.saveCredential({
          token: credential.credential,
          ...(homeRoom?.invite_code ? { defaultRoom: homeRoom.invite_code } : {}),
          ...(identity.handle ? { handle: identity.handle } : {}),
          links,
        });
        deps.ownedClients.set(accountKey, sdk);
        approvedCredentialNeedsCleanup = false;
        let previousCredentialNotice = "";
        if (previous.tokenSource === "config" && previous.configured) {
          try {
            if (!previousOwnedClient) throw new Error("old client unavailable");
            await previousOwnedClient.auth.revoke();
          } catch {
            previousCredentialNotice = "\nThe previous connection could not be revoked automatically. Revoke it under Connected Agents.";
          }
        }
        const ownerName = connectionOwnerName(credential);
        const robot = identity.handle
          ? `${identity.displayName} @${identity.handle}`
          : identity.displayName;
        const claimed = ownerName
          ? `${robot} was claimed by ${ownerName}`
          : `${robot} is now claimed`;
        const joined = homeRoom?.name ? ` and joined #${homeRoom.name}` : "";
        const reach = credential.room_access === "all"
          ? "\nIt can now act for you in all current and future rooms."
          : "\nIt can now act for you only in the rooms you approved.";
        await deps.notify(
          `${claimed}${joined}.${reach}`
            + previousCredentialNotice,
          ctx.sessionKey,
        );
      });
    } catch (error) {
      // If durable storage failed after approval, do not leave an active,
      // unreachable credential behind in Connected Agents.
      if (approvedCredentialNeedsCleanup) {
        try { await sdk.auth.revoke(); } catch { /* best effort */ }
      }
      if (deps.pending.get(accountKey) !== startPromise) return;
      const reason = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: unknown })?.code;
      await deps.notify(
        code === "pairing_expired" || /pairing link expired/i.test(reason)
          ? "The PingRoom claim link expired. Run /pingroom connect again for a fresh one."
          : `PingRoom pairing failed: ${reason}`,
        ctx.sessionKey,
      );
    } finally {
      if (deps.pending.get(accountKey) === startPromise) deps.pending.delete(accountKey);
    }
  })();

  return renderPairingReply(ctx, deps, pending);
}

async function renderPairingReply(
  ctx: CommandContext,
  deps: CommandDeps,
  pending: PendingPairing,
): Promise<CommandReply> {
  const { pairing, expiresAtMs, agentLabel = AGENT_LABEL } = pending;
  const setupCode = pairingQrUrl(pairing) ?? pairing.pair_url;
  const expiresIn = formatDuration(Math.max(
    0,
    Math.ceil((expiresAtMs - (deps.now?.() ?? Date.now())) / 1000),
  ));
  const linkReply = pairingReply(pairing, agentLabel, expiresIn, false);
  const qrReply = pairingReply(pairing, agentLabel, expiresIn, true);

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

function pairingReply(
  pairing: RobotPairingStart,
  fallbackLabel: string,
  expiresIn: string,
  hasQr: boolean,
): CommandReply {
  const pairUrl = pairing.pair_url;
  const installUrl = installAppUrl(pairing);
  const identity = agentIdentity(pairing, fallbackLabel);
  const robot = identity.handle
    ? `${identity.displayName} @${identity.handle}`
    : `a PingRoom robot profile for ${identity.displayName}`;
  return {
    text: hasQr
      ? `Created ${robot}.\nInstall or open PingRoom and sign in first: ${installUrl}\nThe app receives urgent Pings, questions, approvals, handoffs, and live progress on your phone.\nScan the QR or open this claim link: ${pairUrl}\nUse it to claim this robot and choose its rooms. The link expires in ${expiresIn}. If you leave to install the app, return before then. Installing the app does not claim this robot or grant it access.`
      : `Created ${robot}.\nInstall or open PingRoom and sign in first: ${installUrl}\nThe app receives urgent Pings, questions, approvals, handoffs, and live progress on your phone.\nOpen this claim link on your phone: ${pairUrl}\nUse it to claim this robot and choose its rooms. The link expires in ${expiresIn}. If you leave to install the app, return before then. Installing the app does not claim this robot or grant it access.`,
    presentation: {
      title: `Claim ${identity.displayName}`,
      tone: "info",
      blocks: [
        {
          type: "text",
          text: hasQr
            ? "Install or open PingRoom and sign in first. It is where urgent Pings, questions, approvals, handoffs, and live progress arrive. Then scan the QR or open the claim link, claim this separate robot profile, and choose which rooms it may reach. Installing the app does not claim the robot or grant it access."
            : "Install or open PingRoom and sign in first. It is where urgent Pings, questions, approvals, handoffs, and live progress arrive. Then open the claim link, claim this separate robot profile, and choose which rooms it may reach. Installing the app does not claim the robot or grant it access.",
        },
        {
          type: "buttons",
          buttons: [
            { label: "Claim robot in PingRoom", style: "primary", action: { type: "url", url: pairUrl } },
            { label: "Install or open PingRoom", action: { type: "url", url: installUrl } },
          ],
        },
        {
          type: "context",
          text: `This link expires in ${expiresIn}. If you leave to install the app, return before then. While this pairing is pending, /pingroom connect returns the same robot and claim link.`,
        },
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

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Refuse server-controlled install destinations or query-bearing claim data. */
function installAppUrl(payload: unknown): string {
  const value = payload && typeof payload === "object"
    ? payload as {
      app_install_url?: unknown;
      install_app?: unknown;
      install_url?: unknown;
      links?: { install_app?: unknown };
      mobile_app?: { install_url?: unknown };
    }
    : {};
  const candidates = [
    value.app_install_url,
    value.install_app,
    value.install_url,
    value.links?.install_app,
    value.mobile_app?.install_url,
  ];
  for (const candidate of candidates) {
    if (cleanText(candidate) === INSTALL_APP_URL) return INSTALL_APP_URL;
  }
  return INSTALL_APP_URL;
}

/** Resolve the additive robot identity while retaining every legacy fallback. */
function agentIdentity(
  payload: unknown,
  fallbackLabel: string,
): { displayName: string; handle?: string } {
  const value = payload && typeof payload === "object"
    ? payload as { agent?: RobotAgent; handle?: unknown }
    : {};
  const displayName = cleanText(value.agent?.profile?.display_name)
    ?? cleanText(value.agent?.label)
    ?? fallbackLabel;
  const handle = cleanText(value.agent?.profile?.handle)
    ?? cleanText(value.agent?.handle)
    ?? cleanText(value.handle);
  return { displayName, ...(handle ? { handle } : {}) };
}

function connectionHomeRoom(payload: unknown): RoomSummary | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as {
    home_room?: RoomSummary | null;
    room?: RoomSummary | null;
  };
  return value.home_room ?? value.room ?? undefined;
}

function connectionOwnerName(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  return cleanText((payload as { owner?: { name?: unknown } }).owner?.name);
}

function latestPingsUrl(credential: unknown, baseUrl: string): string | undefined {
  const value = (credential as { links?: { latest_pings?: unknown } })?.links?.latest_pings;
  try {
    if (typeof value === "string" && value.trim() && !/\p{Cc}/u.test(value)) {
      const candidate = new URL(value.trim());
      if (
        (candidate.protocol === "https:" || candidate.protocol === "http:")
        && candidate.username === ""
        && candidate.password === ""
      ) return candidate.toString();
    }
    return apiEndpointUrl(baseUrl, "/api/agent/notifications?limit=25&page=1");
  } catch {
    return undefined;
  }
}

function connectionLinks(
  credential: unknown,
  baseUrl: string,
): { latest_pings?: string; install_app: string } {
  const latestPings = latestPingsUrl(credential, baseUrl);
  return {
    ...(latestPings ? { latest_pings: latestPings } : {}),
    install_app: installAppUrl(credential),
  };
}

/**
 * Pair without the SDK's historical default-scope helper. The currently
 * published SDK still injects a client-owned list; using its lower-level
 * registration plus this single request keeps the shipped plugin aligned with
 * the server-owned grant even before the next SDK package release.
 */
export async function startServerOwnedPairing(
  sdk: PingRoom,
  baseUrl: string,
  agentLabel: string,
  request: typeof fetch = globalThis.fetch,
): Promise<RobotPairingStart> {
  const pending = await sdk.auth.register({ type: "anonymous", agent_label: agentLabel });
  sdk.setToken(pending.credential);

  try {
    const response = await request(apiEndpointUrl(baseUrl, "/api/agent/auth/pair/start"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${pending.credential}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json() as Partial<RobotPairingStart> & {
      message?: unknown;
      error?: { message?: unknown };
    };

    if (!response.ok) {
      const detail = typeof payload.error?.message === "string"
        ? payload.error.message
        : typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
      throw new Error(`PingRoom pairing could not start: ${detail}`);
    }
    if (
      typeof payload.pair_token !== "string"
      || typeof payload.pair_url !== "string"
      || typeof payload.expires_in !== "number"
      || typeof payload.poll_interval_ms !== "number"
    ) {
      throw new Error("PingRoom returned an incomplete pairing response.");
    }

    return payload as RobotPairingStart;
  } catch (error) {
    sdk.setToken(null);
    throw error;
  }
}

function isWebChat(ctx: CommandContext): boolean {
  return ctx.channel?.toLowerCase() === "webchat" || ctx.channelId?.toLowerCase() === "webchat";
}

function status(ctx: CommandContext): CommandReply {
  const snapshot = inspectAccount(ctx.config);
  if (!snapshot.enabled) {
    return { text: "PingRoom is disconnected for this OpenClaw channel. Run /pingroom connect to replace the connection." };
  }
  if (!snapshot.configured) {
    return { text: "PingRoom is not connected. Run /pingroom connect." };
  }
  const lines = [
    `PingRoom: connected (credential from ${describeSource(snapshot.tokenSource)})`,
    `  Delivery room: ${snapshot.defaultRoom ?? "not pinned — set channels.pingroom.defaultRoom"}`,
    `  Latest pings: ${snapshot.latestPingsUrl ?? "unavailable"}`,
    `  API: ${snapshot.baseUrl}`,
    `  Inbound polling: ${snapshot.inboundEnabled ? "on" : "off"}`,
    `  Webhook intake: ${snapshot.webhookEnabled ? "on" : "off"}`,
    "  Free accounts get 20 agent operations per day.",
  ];
  return { text: lines.join("\n") };
}

/**
 * Verify that the claimed robot can actually reach a phone, using THIS
 * plugin's credential.
 *
 * The advice used to be "run pingroom activate" in a terminal, which cannot
 * work: that command refuses `--token` and reads only the CLI's own
 * credentials.json, while this plugin's token lives in `channels.pingroom`.
 * Someone following it hit `no saved robot credential` and stopped. The
 * plugin owns a credential, so it runs the ceremony itself.
 */
async function activate(ctx: CommandContext, deps: CommandDeps): Promise<CommandReply> {
  const snapshot = inspectAccount(ctx.config);
  if (!snapshot.enabled) return { text: "PingRoom is disconnected. Run /pingroom connect." };
  if (!snapshot.configured) return { text: "PingRoom is not connected. Run /pingroom connect." };

  const sdk = deps.connectedClient?.() ?? deps.createClient?.(snapshot.baseUrl);
  if (!sdk) return { text: "PingRoom activation is unavailable right now." };

  // Detached on purpose, like connect: activation waits for a human to answer
  // a Question on their phone, which takes as long as it takes. The reply
  // below has to reach them now so they know to look.
  void (async () => {
    try {
      await sdk.inbox.activate();
      await deps.notify(
        "PingRoom is verified — your phone answered the test Question. Handoffs, questions and approvals will reach you.",
        ctx.sessionKey,
      );
    } catch (error) {
      await deps.notify(activationFailureText(error), ctx.sessionKey);
    }
  })();

  return {
    text: "Check your phone — PingRoom is sending a test Question to confirm delivery. Answer it and I'll confirm here.",
  };
}

/** One sentence the owner can act on, per way activation can end badly. */
function activationFailureText(error: unknown): string {
  const code = (error as { code?: unknown; body?: { code?: unknown } })?.code
    ?? (error as { body?: { code?: unknown } })?.body?.code;
  const reason = error instanceof Error ? error.message : String(error);

  if (code === "recipient_not_ready") {
    return `PingRoom could not reach a phone. Install or update PingRoom at ${INSTALL_APP_URL}, open it, sign in, and enable notifications, then run /pingroom activate again. The connection itself is saved and usable.`;
  }
  if (code === "deadline_exceeded" || /deadline/i.test(reason)) {
    return "No answer yet — the test Question is still waiting on your phone. Answer it, or run /pingroom activate again for a fresh one.";
  }
  if (code === "no_room_configured") {
    return "This robot has no home room. Pick one under Connected Agents in the PingRoom app, then run /pingroom activate again.";
  }
  return `PingRoom activation failed: ${reason}`;
}

async function rooms(ctx: CommandContext, deps: CommandDeps): Promise<CommandReply> {
  const snapshot = inspectAccount(ctx.config);
  if (!snapshot.enabled) return { text: "PingRoom is disconnected. Run /pingroom connect." };
  if (!snapshot.configured) return { text: "PingRoom is not connected. Run /pingroom connect." };

  const sdk = deps.connectedClient?.() ?? deps.createClient?.(snapshot.baseUrl);
  if (!sdk) return { text: "PingRoom rooms are unavailable right now." };
  const list = (await sdk.rooms.list()) as Array<{ name?: string; invite_code?: string }>;
  if (!list?.length) return { text: "This agent has no rooms yet." };
  return {
    text: ["Rooms this agent may reach:", ...list.map((r) => `  ${r.name ?? "(unnamed)"} — ${r.invite_code}`)].join("\n"),
  };
}

async function disconnect(ctx: CommandContext, deps: CommandDeps): Promise<CommandReply> {
  return withConnectionMutation(deps, "default", async () => {
    // Invalidate any open ceremony while holding the credential-write lock.
    // A waiter that already reached persistence finishes first, then this
    // command clears it; a waiter that has not reached persistence sees the
    // missing generation and revokes its newly approved credential.
    const pairingCancelled = deps.pending.delete("default");
    const snapshot = inspectAccount(ctx.config);
    const recentlyPairedClient = deps.ownedClients.get("default");
    if (!snapshot.enabled && !snapshot.configured && !pairingCancelled && !recentlyPairedClient) {
      return { text: "PingRoom is already disconnected." };
    }
    if (!snapshot.configured && !recentlyPairedClient) {
      // Persist the disabled state even when this invocation received a stale
      // config snapshot while a pairing save was completing concurrently.
      await deps.saveCredential({ token: "" });
      return { text: pairingCancelled ? "Pending PingRoom connection cancelled." : "PingRoom is not connected." };
    }

    // Only a credential written directly into this plugin's config is owned by
    // this command. Revoking an env/SecretRef/shared-CLI token would silently
    // break its other consumers while leaving their source files unchanged.
    const ownsCredential = snapshot.tokenSource === "config" || recentlyPairedClient !== undefined;
    const sdk = ownsCredential
      ? (recentlyPairedClient ?? deps.connectedClient?.() ?? deps.createClient?.(snapshot.baseUrl))
      : undefined;
    let revoked = false;
    try {
      if (sdk) { await sdk.auth.revoke(); revoked = true; }
    } catch {
      // The local credential still goes away; a live server-side registration
      // is visible (and revocable) under Connected Agents.
    }
    deps.ownedClients.delete("default");
    await deps.saveCredential({ token: "" });
    if (!ownsCredential) {
      return {
        text: `PingRoom disabled locally. The credential from ${describeSource(snapshot.tokenSource)} was not revoked.`,
      };
    }
    if (pairingCancelled) {
      return {
        text: revoked
          ? "Pending PingRoom connection cancelled and its credential revoked."
          : "Pending PingRoom connection cancelled locally. Revoke it under Connected Agents in the app.",
      };
    }
    return {
      text: revoked
        ? "PingRoom disconnected and the credential revoked."
        : "PingRoom credential cleared locally. Revoke it under Connected Agents in the app.",
    };
  });
}

async function withConnectionMutation<T>(
  deps: CommandDeps,
  accountKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = deps.mutationTails.get(accountKey) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => { release = resolve; });
  deps.mutationTails.set(accountKey, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (deps.mutationTails.get(accountKey) === tail) deps.mutationTails.delete(accountKey);
  }
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
