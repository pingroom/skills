import test from "node:test";
import assert from "node:assert/strict";

import { runCommand } from "../dist/commands.js";

const PAIR_URL = "https://api.pingroom.io/pair?token=pair_123";
const PAIR_QR_URL = "https://pingroom.io/app/agents/pair?token=pair_123";

function commandHarness(overrides = {}) {
  const pairing = {
    pair_token: "pair_123",
    pair_url: PAIR_URL,
    pair_qr_url: PAIR_QR_URL,
    expires_in: 900,
    poll_interval_ms: 1500,
    ...overrides.pairing,
  };
  const waitForever = new Promise(() => {});
  const rendered = [];
  const errors = [];
  const deps = {
    pending: new Set(),
    now: () => 1_725_000_000_000,
    createClient: () => ({
      auth: {
        startPairing: async () => pairing,
        waitForPairing: () => waitForever,
      },
    }),
    saveCredential: async () => {},
    notify: async () => {},
    renderPairingQr: async (setupCode) => {
      rendered.push(setupCode);
      return "/managed/outbound/pingroom-pairing.png";
    },
    onPairingQrRenderError: () => errors.push("failed"),
    ...overrides.deps,
  };
  return { deps, errors, rendered };
}

test("connect gives WebChat an ephemeral native pairing QR", async () => {
  const { deps, rendered } = commandHarness();

  const reply = await runCommand(
    { args: "connect", channel: "webchat", config: {} },
    deps,
  );

  assert.deepEqual(reply.channelData, {
    openclawPairingQr: {
      setupCode: PAIR_QR_URL,
      expiresAtMs: 1_725_000_900_000,
    },
  });
  assert.equal(reply.sensitiveMedia, true);
  assert.equal(reply.mediaUrl, undefined);
  assert.deepEqual(rendered, [], "WebChat owns live QR rendering");
  assert.match(reply.text, /^Scan the QR/);
  assert.match(reply.text, new RegExp(PAIR_URL.replaceAll("?", "\\?")));
});

test("connect attaches a managed sensitive PNG on external channels", async () => {
  const { deps, rendered } = commandHarness();

  const reply = await runCommand(
    { args: "connect", channel: "telegram", channelId: "telegram", config: {} },
    deps,
  );

  assert.deepEqual(rendered, [PAIR_QR_URL]);
  assert.equal(reply.mediaUrl, "/managed/outbound/pingroom-pairing.png");
  assert.equal(reply.trustedLocalMedia, true);
  assert.equal(reply.sensitiveMedia, true);
  assert.deepEqual(reply.attachments, [{
    type: "image",
    mediaUrl: "/managed/outbound/pingroom-pairing.png",
    mimeType: "image/png",
    name: "pingroom-pairing.png",
    trustedLocalMedia: true,
  }]);
  assert.equal(reply.presentation.blocks[1].buttons[0].action.url, PAIR_URL);
});

test("connect describes the expiry reported by the pairing server", async () => {
  const { deps } = commandHarness({
    pairing: { expires_in: 120 },
  });

  const reply = await runCommand(
    { args: "connect", channel: "telegram", config: {} },
    deps,
  );

  assert.match(reply.text, /Expires in 2 minutes\./);
  assert.match(reply.presentation.blocks[2].text, /Expires in 2 minutes/);
});

test("connect renders pair_url for servers that predate pair_qr_url", async () => {
  const { deps, rendered } = commandHarness({
    pairing: { pair_qr_url: undefined },
  });

  await runCommand({ args: "connect", channel: "discord", config: {} }, deps);

  assert.deepEqual(rendered, [PAIR_URL]);
});

test("connect keeps its approval link when QR rendering fails", async () => {
  const { deps, errors } = commandHarness({
    deps: {
      renderPairingQr: async () => { throw new Error("renderer unavailable"); },
    },
  });

  const reply = await runCommand(
    { args: "connect", channel: "signal", config: {} },
    deps,
  );

  assert.equal(reply.mediaUrl, undefined);
  assert.equal(reply.attachments, undefined);
  assert.equal(reply.trustedLocalMedia, undefined);
  assert.equal(reply.sensitiveMedia, undefined);
  assert.deepEqual(errors, ["failed"]);
  assert.match(reply.text, /^Approve PingRoom access/);
  assert.match(reply.text, new RegExp(PAIR_URL.replaceAll("?", "\\?")));
  assert.equal(reply.presentation.blocks[1].buttons[0].action.url, PAIR_URL);
});
