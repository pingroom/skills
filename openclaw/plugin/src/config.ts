import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_LABEL, DEFAULT_BASE_URL, PING_MESSAGE_MAX } from "./constants.js";

/** `channels.pingroom` as an operator writes it. */
export interface PingRoomChannelConfig {
  enabled?: boolean;
  token?: string | SecretRefLike;
  useCliCredential?: boolean;
  baseUrl?: string;
  agentLabel?: string;
  defaultRoom?: string;
  dmPolicy?: string;
  allowFrom?: string[];
  urgency?: "normal" | "urgent";
  requireAck?: boolean;
  visibleReplies?: "final" | "all";
  maxChunksPerReply?: number;
  overflow?: "truncate" | "attach";
  questionTtlSeconds?: number;
  inbound?: { enabled?: boolean; pollTimeoutSeconds?: number };
  webhook?: { enabled?: boolean; path?: string; secret?: string | SecretRefLike };
  execEnv?: { enabled?: boolean; injectToken?: boolean };
  scopes?: string[];
}

export interface SecretRefLike {
  source: "env" | "file" | "exec" | "store";
  provider?: string;
  id: string;
}

export type TokenSource = "config" | "secret-ref" | "env" | "cli-credential" | "missing";

export interface ResolvedAccount {
  accountId: string;
  token: string;
  baseUrl: string;
  agentLabel: string;
  defaultRoom?: string;
  dmPolicy: "allowlist" | "open" | "disabled";
  allowFrom: string[];
  urgency: "normal" | "urgent";
  requireAck: boolean;
  visibleReplies: "final" | "all";
  maxChunksPerReply: number;
  overflow: "truncate" | "attach";
  questionTtlSeconds: number;
  pollTimeoutSeconds: number;
  inboundEnabled: boolean;
  webhook: { enabled: boolean; path: string; secret?: string | SecretRefLike };
  execEnv: { enabled: boolean; injectToken: boolean };
  scopes?: string[];
}

/** What `openclaw status` may print: state, never the credential. */
export interface AccountSnapshot {
  enabled: boolean;
  configured: boolean;
  tokenSource: TokenSource;
  baseUrl: string;
  defaultRoom?: string;
  inboundEnabled: boolean;
  webhookEnabled: boolean;
}

export function isSecretRef(value: unknown): value is SecretRefLike {
  return (
    typeof value === "object" && value !== null
    && typeof (value as SecretRefLike).source === "string"
    && typeof (value as SecretRefLike).id === "string"
  );
}

export function readChannelConfig(cfg: unknown): PingRoomChannelConfig {
  const channels = (cfg as { channels?: Record<string, unknown> } | undefined)?.channels;
  const section = channels?.pingroom;
  return (typeof section === "object" && section !== null ? section : {}) as PingRoomChannelConfig;
}

/** Path the CLI stores its paired credential at, honoring PINGROOM_HOME. */
export function cliCredentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.PINGROOM_HOME || join(homedir(), ".pingroom"), "credentials.json");
}

function readCliCredential(env: NodeJS.ProcessEnv): { token?: string; api_url?: string; room?: { invite_code?: string } } | null {
  const path = cliCredentialPath(env);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return typeof parsed?.token === "string" ? (parsed as never) : null;
  } catch {
    // A corrupt file is "no credential", not a crash on every status call.
    return null;
  }
}

/**
 * Where the credential comes from, in precedence order, WITHOUT resolving a
 * SecretRef — the host resolves those into its startup snapshot, and this runs
 * on paths (like `openclaw status`) that must not touch secrets at all.
 */
export function describeTokenSource(
  config: PingRoomChannelConfig,
  env: NodeJS.ProcessEnv = process.env,
): TokenSource {
  if (typeof config.token === "string" && config.token !== "") return "config";
  if (isSecretRef(config.token)) return "secret-ref";
  if (typeof env.PINGROOM_TOKEN === "string" && env.PINGROOM_TOKEN !== "") return "env";
  if (config.useCliCredential !== false && readCliCredential(env)?.token) return "cli-credential";
  return "missing";
}

/** Synchronous, secret-free account state for status surfaces. */
export function inspectAccount(cfg: unknown, env: NodeJS.ProcessEnv = process.env): AccountSnapshot {
  const config = readChannelConfig(cfg);
  const tokenSource = describeTokenSource(config, env);
  return {
    enabled: config.enabled !== false,
    configured: tokenSource !== "missing",
    tokenSource,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    ...(resolveDefaultRoom(config, env) ? { defaultRoom: resolveDefaultRoom(config, env) } : {}),
    inboundEnabled: config.inbound?.enabled !== false,
    webhookEnabled: config.webhook?.enabled === true,
  };
}

function resolveDefaultRoom(config: PingRoomChannelConfig, env: NodeJS.ProcessEnv): string | undefined {
  return config.defaultRoom ?? env.PINGROOM_ROOM ?? readCliCredential(env)?.room?.invite_code;
}

export class PingRoomConfigError extends Error {}

/**
 * Resolve one account for the runtime.
 *
 * `resolveSecret` is injected rather than imported so the pure path stays
 * testable and so the host's SecretRef resolver is the only thing that ever
 * materializes a stored secret.
 */
export function resolveAccount(
  cfg: unknown,
  accountId: string | null | undefined,
  {
    env = process.env,
    resolveSecret,
  }: { env?: NodeJS.ProcessEnv; resolveSecret?: (ref: SecretRefLike) => string | undefined } = {},
): ResolvedAccount {
  const config = readChannelConfig(cfg);

  // OpenClaw's `pairing` DM policy sends a short code to an unknown sender.
  // PingRoom has no way to DM a non-member (cross-account pings are retired),
  // and broadcasting a code into a shared room shows it to everyone, so the
  // policy cannot be honored and must not be silently downgraded either.
  const dmPolicy = config.dmPolicy ?? "allowlist";
  if (dmPolicy === "pairing") {
    throw new PingRoomConfigError(
      'channels.pingroom.dmPolicy: "pairing" is not supported — PingRoom cannot DM an unknown sender a code. '
      + 'Use "allowlist" with channels.pingroom.allowFrom, or "open".',
    );
  }
  if (dmPolicy !== "allowlist" && dmPolicy !== "open" && dmPolicy !== "disabled") {
    throw new PingRoomConfigError(`channels.pingroom.dmPolicy: unknown value "${dmPolicy}".`);
  }

  const token = resolveToken(config, env, resolveSecret);
  if (!token) {
    throw new PingRoomConfigError(
      "PingRoom is not connected. Run /pingroom connect in chat, set channels.pingroom.token, "
      + "or set PINGROOM_TOKEN.",
    );
  }

  const maxChunks = clampInt(config.maxChunksPerReply, 1, 5, 2);
  return {
    accountId: accountId ?? "default",
    token,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    agentLabel: config.agentLabel ?? AGENT_LABEL,
    ...(resolveDefaultRoom(config, env) ? { defaultRoom: resolveDefaultRoom(config, env) } : {}),
    dmPolicy,
    allowFrom: Array.isArray(config.allowFrom) ? config.allowFrom.map(String) : [],
    urgency: config.urgency === "urgent" ? "urgent" : "normal",
    requireAck: config.requireAck === true,
    visibleReplies: config.visibleReplies === "all" ? "all" : "final",
    maxChunksPerReply: maxChunks,
    overflow: config.overflow === "attach" ? "attach" : "truncate",
    questionTtlSeconds: clampInt(config.questionTtlSeconds, 30, 86400, 900),
    pollTimeoutSeconds: clampInt(config.inbound?.pollTimeoutSeconds, 5, 30, 25),
    inboundEnabled: config.inbound?.enabled !== false,
    webhook: {
      enabled: config.webhook?.enabled === true,
      path: config.webhook?.path ?? "/pingroom/events",
      ...(config.webhook?.secret ? { secret: config.webhook.secret } : {}),
    },
    execEnv: {
      enabled: config.execEnv?.enabled !== false,
      injectToken: config.execEnv?.injectToken === true,
    },
    ...(config.scopes ? { scopes: config.scopes } : {}),
  };
}

function resolveToken(
  config: PingRoomChannelConfig,
  env: NodeJS.ProcessEnv,
  resolveSecret?: (ref: SecretRefLike) => string | undefined,
): string | undefined {
  if (typeof config.token === "string" && config.token !== "") return config.token;
  if (isSecretRef(config.token)) return resolveSecret?.(config.token);
  if (env.PINGROOM_TOKEN) return env.PINGROOM_TOKEN;
  if (config.useCliCredential !== false) return readCliCredential(env)?.token;
  return undefined;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(Math.max(n, min), max);
}

/** The effective per-Ping body limit for this account. */
export function messageLimit(): number {
  return PING_MESSAGE_MAX;
}
