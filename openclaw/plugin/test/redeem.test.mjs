import test from "node:test";
import assert from "node:assert/strict";
import { PingRoom } from "@pingroom/sdk";
import { runCommand } from "../dist/commands.js";
import { createRedeemCodeTool } from "../dist/redeem.js";

const gift = {
  message: "Gift redeemed.", kind: "gift", reward_days: 30, package: "monthly",
  lifetime: false, plan: "pro", plan_expires_at: "2026-10-05T00:00:00Z",
};
const config = { channels: { pingroom: { token: "plugin_token", useCliCredential: false } } };
const ctx = { senderIsOwner: true, channel: "webchat", config };

function harness(response = gift, status = 200) {
  const calls = [];
  const sdk = new PingRoom({ token: "plugin_token", fetch: async (url, init) => {
    calls.push({ url: new URL(url), ...init });
    return new Response(JSON.stringify(response), { status });
  } });
  return {
    calls,
    deps: {
      connectedClient: () => sdk, isConnected: () => true,
      pending: new Map(), mutationTails: new Map(), ownedClients: new Map(),
      saveCredential: async () => { throw new Error("must not change connection"); },
      notify: async () => { throw new Error("must not send code as a notification"); },
    },
  };
}

test("native command redeems with the plugin credential without a CLI or room", async () => {
  const { calls, deps } = harness();
  const reply = await runCommand({ ...ctx, args: "redeem ab12cd34ef56" }, deps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/agent/redeem-code");
  assert.equal(calls[0].headers.Authorization, "Bearer plugin_token");
  assert.deepEqual(JSON.parse(calls[0].body), { code: "AB12CD34EF56" });
  assert.match(reply.text, /Pro until 2026-10-05/);
  assert.doesNotMatch(reply.text, /AB12CD34EF56|ab12cd34ef56|plugin_token/);
});

test("native command rejects malformed, missing, and extra codes before sending", async () => {
  const { calls, deps } = harness();
  for (const args of ["redeem", "redeem abc", "redeem AB12CD34EF56 extra", "redeem abcdefghijß"]) {
    const reply = await runCommand({ ...ctx, args }, deps);
    assert.match(reply.text, /Usage:|exactly 12/);
  }
  assert.equal(calls.length, 0);
});

test("redemption requires an enabled connection and never uses a pairing client", async () => {
  const { calls, deps } = harness();
  const reply = await runCommand({ ...ctx, args: "redeem AB12CD34EF56",
    config: { channels: { pingroom: { enabled: false, useCliCredential: false } } },
  }, deps);
  assert.match(reply.text, /\/pingroom connect/);
  assert.equal(calls.length, 0);
});

test("native tool is exposed only to a trusted owner in a private session", () => {
  const { calls, deps } = harness();
  for (const context of [{ isPrivate: true }, { senderIsOwner: false, isPrivate: true }, { senderIsOwner: true, isPrivate: false }]) {
    assert.equal(createRedeemCodeTool(context, deps), null);
  }
  assert.equal(calls.length, 0);
});

test("native tool returns lifetime entitlement and normalizes the code", async () => {
  const lifetime = { ...gift, kind: "redeem", reward_days: null, package: "lifetime", lifetime: true, plan_expires_at: null };
  const { calls, deps } = harness(lifetime);
  const tool = createRedeemCodeTool({ senderIsOwner: true, isPrivate: true }, deps);
  assert.equal(tool.name, "pingroom_redeem_code");
  const result = await tool.execute("call-1", { code: " ab12cd34ef56 " });
  assert.deepEqual(result.details, { ...lifetime, message: result.content[0].text });
  assert.match(result.content[0].text, /lifetime Pro/);
  assert.doesNotMatch(JSON.stringify(result), /AB12CD34EF56|ab12cd34ef56/);
  assert.deepEqual(JSON.parse(calls[0].body), { code: "AB12CD34EF56" });
});

test("native tool checks the current enabled state before using the credential", async () => {
  const { calls, deps } = harness();
  let connected = true;
  const tool = createRedeemCodeTool({ senderIsOwner: true, isPrivate: true }, { ...deps, isConnected: () => connected });
  connected = false;
  const result = await tool.execute("call-1", { code: "AB12CD34EF56" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /\/pingroom connect/);
  assert.equal(calls.length, 0);
});

test("redemption errors are returned without retrying or leaking the code", async () => {
  for (const [status, body, expected] of [
    [403, { message: "Permission denied.", code: "insufficient_scope" }, /\/pingroom connect/],
    [422, { message: "Invalid", errors: { code: ["Code Ab12cD34Ef56 was already redeemed."] } }, /already redeemed/],
    [429, { message: "Too many attempts." }, /Too many attempts/],
  ]) {
    const { calls, deps } = harness(body, status);
    const tool = createRedeemCodeTool({ senderIsOwner: true, isPrivate: true }, deps);
    const result = await tool.execute("call-1", { code: "ab12cd34ef56" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, expected);
    assert.doesNotMatch(result.content[0].text, /ab12cd34ef56/i);
    assert.equal(calls.length, 1);
  }
});

test("malformed success receipts remain unconfirmed and are never retried", async () => {
  for (const body of [{}, null, { ...gift, plan: "free" }, { ...gift, plan_expires_at: null }, { ...gift, lifetime: true }, { ...gift, reward_days: -1 }]) {
    const { calls, deps } = harness(body);
    const tool = createRedeemCodeTool({ senderIsOwner: true, isPrivate: true }, deps);
    const result = await tool.execute("call-1", { code: "AB12CD34EF56" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Check your Pro status/);
    assert.doesNotMatch(result.content[0].text, /Code redeemed|undefined/);
    assert.equal(calls.length, 1);
  }
});

test("successful tool receipts discard response extras and code echoes", async () => {
  const { deps } = harness({ ...gift, message: "Redeemed AB12CD34EF56", package: "Ab12cD34Ef56", code: "AB12CD34EF56", extra: { token: "secret" } });
  const tool = createRedeemCodeTool({ senderIsOwner: true, isPrivate: true }, deps);
  const result = await tool.execute("call-1", { code: "AB12CD34EF56" });
  assert.equal(result.isError, undefined);
  assert.equal(result.details.code, undefined);
  assert.equal(result.details.extra, undefined);
  assert.doesNotMatch(JSON.stringify(result), /ab12cd34ef56|secret/i);
});
