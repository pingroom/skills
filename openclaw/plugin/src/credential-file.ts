import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Write a credentials.json the `pingroom` CLI can read.
 *
 * This is what makes `exec pingroom …` work inside an agent turn without the
 * token ever entering the environment: the exec hook exports PINGROOM_HOME (a
 * path), and the CLI reads the credential from here. Same shape and same 0600
 * mode as the CLI's own writer.
 */
export function writeCliCredential(
  home: string,
  credential: { token: string; handle?: string; room?: { invite_code?: string; name?: string }; apiBase: string },
): string {
  const path = join(home, "credentials.json");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(
    path,
    `${JSON.stringify({
      version: 1,
      token: credential.token,
      handle: credential.handle ?? null,
      room: credential.room ?? null,
      rooms: [],
      room_access: null,
      account: null,
      scopes: [],
      api_url: credential.apiBase,
      created_at: new Date().toISOString(),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
  return path;
}
