import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeTokenSource, inspectAccount, resolveAccount, PingRoomConfigError } from "../dist/config.js";

const cfg = (pingroom) => ({ channels: { pingroom } });

/** An empty PINGROOM_HOME, so a test never reads the developer's real one. */
function emptyHome() {
  return { PINGROOM_HOME: mkdtempSync(join(tmpdir(), "pr-oc-empty-")) };
}

function homeWithCredential(token = "cli_tok", extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "pr-oc-"));
  writeFileSync(join(home, "credentials.json"), JSON.stringify({
    version: 1, token, api_url: "https://api.pingroom.io", room: { invite_code: "ab12cd" }, ...extra,
  }));
  return home;
}

test("the credential comes from config, then env, then the paired CLI file", () => {
  const home = homeWithCredential();
  const env = { PINGROOM_HOME: home, PINGROOM_TOKEN: "env_tok" };

  assert.equal(describeTokenSource({ token: "cfg_tok" }, env), "config");
  assert.equal(describeTokenSource({}, env), "env");
  assert.equal(describeTokenSource({}, { PINGROOM_HOME: home }), "cli-credential");
  assert.equal(describeTokenSource({}, emptyHome()), "missing");

  assert.equal(resolveAccount(cfg({ token: "cfg_tok" }), null, { env }).token, "cfg_tok");
  assert.equal(resolveAccount(cfg({}), null, { env }).token, "env_tok");
  assert.equal(resolveAccount(cfg({}), null, { env: { PINGROOM_HOME: home } }).token, "cli_tok");
});

test("a SecretRef is resolved by the host, never read from disk here", () => {
  const ref = { source: "env", provider: "default", id: "PINGROOM_TOKEN" };
  assert.equal(describeTokenSource({ token: ref }, {}), "secret-ref");
  const account = resolveAccount(cfg({ token: ref }), null, {
    env: emptyHome(),
    resolveSecret: (r) => (r.id === "PINGROOM_TOKEN" ? "from_host" : undefined),
  });
  assert.equal(account.token, "from_host");
});

test("useCliCredential:false stops the plugin borrowing the human's own CLI pairing", () => {
  const home = homeWithCredential();
  assert.equal(describeTokenSource({ useCliCredential: false }, { PINGROOM_HOME: home }), "missing");
});

test("no credential is an explanatory error, not a crash", () => {
  assert.throws(() => resolveAccount(cfg({}), null, { env: emptyHome() }), (error) => {
    assert.ok(error instanceof PingRoomConfigError);
    assert.match(error.message, /\/pingroom connect/);
    return true;
  });
});

test('dmPolicy "pairing" is refused with the reason, not silently downgraded', () => {
  // OpenClaw's pairing DMs a code to an unknown sender; PingRoom cannot DM a
  // non-member, and putting the code in a shared room shows it to everyone.
  assert.throws(
    () => resolveAccount(cfg({ token: "t", dmPolicy: "pairing" }), null, { env: emptyHome() }),
    /cannot DM an unknown sender/,
  );
  assert.throws(() => resolveAccount(cfg({ token: "t", dmPolicy: "nonsense" }), null, { env: emptyHome() }), /unknown value/);
});

test("defaults are the quota-safe ones", () => {
  const account = resolveAccount(cfg({ token: "t" }), null, { env: emptyHome() });
  assert.equal(account.visibleReplies, "final", "only final replies should become pushes");
  assert.equal(account.maxChunksPerReply, 2);
  assert.equal(account.overflow, "truncate");
  assert.equal(account.dmPolicy, "allowlist");
  assert.equal(account.urgency, "normal");
  assert.equal(account.questionTtlSeconds, 900, "matches the ask_user default");
  assert.equal(account.execEnv.injectToken, false, "the token must not reach audit metadata by default");
});

test("out-of-range numbers are clamped rather than rejected", () => {
  const account = resolveAccount(
    cfg({ token: "t", maxChunksPerReply: 99, questionTtlSeconds: 5, inbound: { pollTimeoutSeconds: 900 } }),
    null,
    { env: emptyHome() },
  );
  assert.equal(account.maxChunksPerReply, 5);
  assert.equal(account.questionTtlSeconds, 30);
  assert.equal(account.pollTimeoutSeconds, 30);
});

test("inspectAccount reports state and never the credential", () => {
  const snapshot = inspectAccount(cfg({ token: "super_secret_value" }), emptyHome());
  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.tokenSource, "config");
  assert.ok(!JSON.stringify(snapshot).includes("super_secret_value"));
});

test("the latest-pings URL survives config and shared CLI credentials", () => {
  const configured = inspectAccount(cfg({
    token: "t",
    links: { latest_pings: "https://api.pingroom.io/custom-feed" },
  }), emptyHome());
  assert.equal(configured.latestPingsUrl, "https://api.pingroom.io/custom-feed");

  const home = homeWithCredential("cli_tok", {
    links: { latest_pings: "https://api.pingroom.io/api/agent/notifications?limit=25&page=1" },
  });
  const shared = inspectAccount(cfg({}), { PINGROOM_HOME: home });
  assert.equal(
    shared.latestPingsUrl,
    "https://api.pingroom.io/api/agent/notifications?limit=25&page=1",
  );
});

test("a configured token never inherits stale CLI room or link metadata", () => {
  const home = homeWithCredential("cli_tok", {
    api_url: "https://other.example.test",
    links: { latest_pings: "https://other.example.test/private-feed" },
  });
  const snapshot = inspectAccount(cfg({ token: "configured_tok" }), { PINGROOM_HOME: home });

  assert.equal(snapshot.baseUrl, "https://api.pingroom.io");
  assert.equal(snapshot.defaultRoom, undefined);
  assert.equal(
    snapshot.latestPingsUrl,
    "https://api.pingroom.io/api/agent/notifications?limit=25&page=1",
  );
});

test("the latest-pings fallback preserves a self-hosted path prefix", () => {
  const snapshot = inspectAccount(cfg({
    token: "configured_tok",
    baseUrl: "https://self-hosted.example.test/pingroom/",
  }), emptyHome());

  assert.equal(
    snapshot.latestPingsUrl,
    "https://self-hosted.example.test/pingroom/api/agent/notifications?limit=25&page=1",
  );
});

test("a shared CLI credential carries its API origin and rejects credential-bearing feed links", () => {
  const home = homeWithCredential("cli_tok", {
    api_url: "https://self-hosted.example.test",
    links: { latest_pings: "https://secret@self-hosted.example.test/collect" },
  });
  const snapshot = inspectAccount(cfg({}), { PINGROOM_HOME: home });

  assert.equal(snapshot.baseUrl, "https://self-hosted.example.test");
  assert.equal(
    snapshot.latestPingsUrl,
    "https://self-hosted.example.test/api/agent/notifications?limit=25&page=1",
  );
});
