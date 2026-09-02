import test from "node:test";
import assert from "node:assert/strict";

test("the entry loads without touching the network or starting timers", async () => {
  // Discovery loads this module too. If importing it opened a socket or
  // constructed an SDK client, every `openclaw plugins list` would pay for it.
  const originalFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched += 1; throw new Error("no network during import"); };
  try {
    const entry = (await import("../dist/index.js")).default;
    assert.equal(entry.id, "pingroom");
    assert.equal(entry.name, "PingRoom");
    assert.ok(entry.description.length > 0);
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the setup entry is loadable on its own", async () => {
  const setup = (await import("../dist/setup-entry.js")).default;
  assert.ok(setup, "setup-entry must export something the host can load");
});

test("the channel advertises limits that match PingRoom's own", async () => {
  const { pingroomChannelPlugin } = await import("../dist/channel.js");
  assert.equal(pingroomChannelPlugin.id, "pingroom");
  // createChatChannelPlugin only merges `outbound.base` into a real adapter
  // when `attachedResults` is present; a nested `base` here would mean every
  // setting below is invisible to the host.
  const outbound = pingroomChannelPlugin.outbound;
  assert.equal(outbound.base, undefined, "outbound must be a flat adapter, not { base }");
  assert.equal(typeof outbound.sendText, "function");
  assert.equal(typeof outbound.sendPayload, "function");
  assert.equal(outbound.textChunkLimit, 120, "a private-room ping body caps at 120");
  const limits = outbound.presentationCapabilities.limits;
  assert.equal(limits.actions.maxActions, 4, "a PingRoom Question carries at most 4 options");
  assert.equal(limits.actions.maxLabelLength, 40);
  assert.equal(limits.text.markdownDialect, "plain", "a lock-screen ping renders markdown literally");
  assert.equal(outbound.preferFinalAssistantVisibleText, true, "quota guard: only final replies ping");
});

test("the channel does not offer OpenClaw DM pairing", async () => {
  // PingRoom cannot DM an unknown sender a code, so claiming the capability
  // would strand anyone who set dmPolicy: "pairing".
  const { pingroomChannelPlugin } = await import("../dist/channel.js");
  assert.equal(pingroomChannelPlugin.pairing, undefined);
});
