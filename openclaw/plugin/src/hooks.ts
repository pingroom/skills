import type { ResolvedAccount } from "./config.js";

export interface ExecEnvContribution {
  PINGROOM_HOME?: string;
  PINGROOM_API_URL?: string;
  PINGROOM_ROOM?: string;
  PINGROOM_TOKEN?: string;
}

/**
 * What `resolve_exec_env` contributes so a `pingroom` CLI call inside an agent
 * turn is already authenticated.
 *
 * It exports a PATH, not the credential. OpenClaw includes hook-contributed env
 * in Gateway approval and audit metadata, so putting the JWT here would write it
 * into audit records on every exec. `PINGROOM_TOKEN` is only added when the
 * operator explicitly opts in, which is also the only way a sandboxed exec (no
 * shared filesystem) can authenticate.
 */
export function execEnvFor(
  account: ResolvedAccount,
  credentialHome: string,
): ExecEnvContribution {
  if (!account.execEnv.enabled) return {};
  return {
    PINGROOM_HOME: credentialHome,
    PINGROOM_API_URL: account.baseUrl,
    ...(account.defaultRoom ? { PINGROOM_ROOM: account.defaultRoom } : {}),
    ...(account.execEnv.injectToken ? { PINGROOM_TOKEN: account.token } : {}),
  };
}
