import test from "node:test";
import assert from "node:assert/strict";

import { runCommand, startServerOwnedPairing } from "../dist/commands.js";

const PAIR_URL = "https://api.pingroom.io/pair?token=pair_123";
const PAIR_QR_URL = "https://pingroom.io/app/agents/pair?token=pair_123";
const INSTALL_APP_URL = "https://pingroom.io/i";

function ownerContext(context) {
  return { ...context, senderIsOwner: true };
}

function commandHarness(overrides = {}) {
  const pairing = {
    pair_token: "pair_123",
    pair_url: PAIR_URL,
    pair_qr_url: PAIR_QR_URL,
    app_install_url: INSTALL_APP_URL,
    expires_in: 900,
    poll_interval_ms: 1500,
    ...overrides.pairing,
  };
  const waitForever = new Promise(() => {});
  const rendered = [];
  const errors = [];
  const pairingRequests = [];
  const deps = {
    pending: new Map(),
    mutationTails: new Map(),
    ownedClients: new Map(),
    now: () => 1_725_000_000_000,
    createClient: () => ({
      auth: {
        waitForPairing: () => waitForever,
      },
    }),
    startPairing: async (_sdk, _baseUrl, agentLabel) => {
      pairingRequests.push({ agent_label: agentLabel });
      return pairing;
    },
    saveCredential: async () => {},
    notify: async () => {},
    renderPairingQr: async (setupCode) => {
      rendered.push(setupCode);
      return "/managed/outbound/pingroom-pairing.png";
    },
    onPairingQrRenderError: () => errors.push("failed"),
    ...overrides.deps,
  };
  return { deps, errors, pairingRequests, rendered };
}

test("help explains the mobile value while keeping installation separate from consent", async () => {
  const reply = await runCommand({ args: "help", config: {} }, commandHarness().deps);

  assert.match(reply.text, /urgent Pings, questions, approvals, handoffs, and live progress/);
  assert.match(reply.text, new RegExp(INSTALL_APP_URL.replaceAll("/", "\\/")));
  assert.match(reply.text, /Installing the app does not claim a robot or grant it access/);
  assert.match(reply.text, /recipient_not_ready/);
  assert.match(reply.text, /enable notifications, then run \/pingroom activate/);
  assert.match(reply.text, /\/pingroom connect/);
});

test("connection management fails closed when owner identity is missing or false", async () => {
  for (const args of ["connect", "status", "rooms", "disconnect"]) {
    for (const senderIsOwner of [undefined, false]) {
      const { deps, pairingRequests } = commandHarness();
      const context = {
        args,
        config: { channels: { pingroom: { token: "agent_token" } } },
        ...(senderIsOwner === undefined ? {} : { senderIsOwner }),
      };
      const reply = await runCommand(context, deps);

      assert.match(reply.text, /Only the account owner/);
      assert.deepEqual(pairingRequests, []);
    }
  }
});

test("claim links and room invite codes stay out of group conversations", async () => {
  for (const args of ["connect", "status", "rooms"]) {
    const { deps, pairingRequests } = commandHarness();
    const reply = await runCommand({
      args,
      channel: "telegram",
      sessionKey: "agent:main:telegram:group:-100123",
      senderIsOwner: true,
      config: { channels: { pingroom: { token: "agent_token" } } },
    }, deps);

    assert.match(reply.text, /OpenClaw WebChat or a direct-message session/);
    assert.doesNotMatch(reply.text, /pair_123|room123/);
    assert.deepEqual(pairingRequests, []);
  }
});

test("a persisted direct-chat classification allows the default main DM session", async () => {
  const { deps } = commandHarness();
  const reply = await runCommand({
    args: "connect",
    channel: "telegram",
    sessionKey: "agent:main:main",
    conversationKind: "direct",
    senderIsOwner: true,
    config: {},
  }, deps);

  assert.match(reply.text, /Scan the QR/);
  assert.match(reply.text, /pair_123/);
});

test("connect gives WebChat an ephemeral native pairing QR without client-selected scopes", async () => {
  const { deps, pairingRequests, rendered } = commandHarness();

  const reply = await runCommand(
    ownerContext({ args: "connect", channel: "webchat", config: {} }),
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
  assert.deepEqual(pairingRequests, [{ agent_label: "OpenClaw" }]);
  assert.match(reply.text, /^Created a PingRoom robot profile for OpenClaw\./);
  assert.match(reply.text, /Install or open PingRoom and sign in first/);
  assert.match(reply.text, /urgent Pings, questions, approvals, handoffs, and live progress/);
  assert.match(reply.text, /Installing the app does not claim this robot or grant it access/);
  assert.match(reply.text, new RegExp(PAIR_URL.replaceAll("?", "\\?")));
  assert.equal(reply.presentation.title, "Claim OpenClaw");
  assert.equal(reply.presentation.blocks[1].buttons[0].label, "Claim robot in PingRoom");
  assert.equal(reply.presentation.blocks[1].buttons[0].action.url, PAIR_URL);
  assert.equal(reply.presentation.blocks[1].buttons[1].label, "Install or open PingRoom");
  assert.equal(reply.presentation.blocks[1].buttons[1].action.url, INSTALL_APP_URL);
  assert.doesNotMatch(reply.presentation.blocks[1].buttons[1].action.url, /pair_123|token=/);
});

test("connect names the precreated robot profile before the owner signs in", async () => {
  const { deps } = commandHarness({
    pairing: {
      flow_version: 2,
      claim_mode: "agent_identity",
      agent: {
        id: "agent-1",
        label: "OpenClaw",
        handle: "agt_openclaw",
        profile: {
          display_name: "OpenClaw",
          handle: "agt_openclaw",
          avatar_id: "bots-3",
          avatar_url: "https://api.pingroom.io/avatars/bots-3.png",
        },
      },
    },
  });

  const reply = await runCommand(
    ownerContext({ args: "connect", channel: "webchat", config: {} }),
    deps,
  );

  assert.match(reply.text, /^Created OpenClaw @agt_openclaw\./);
  assert.match(reply.text, /claim this robot/);
  assert.match(reply.presentation.blocks[0].text, /separate robot profile/);
});

test("simultaneous connect commands reuse the same in-flight QR instead of replacing it", async () => {
  let releaseStart;
  let starts = 0;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  const { deps } = commandHarness({
    deps: {
      startPairing: async () => {
        starts += 1;
        await startGate;
        return {
          pair_token: "pair_123",
          pair_url: PAIR_URL,
          pair_qr_url: PAIR_QR_URL,
          expires_in: 900,
          poll_interval_ms: 1500,
        };
      },
    },
  });

  const first = runCommand(ownerContext({ args: "connect", channel: "webchat", config: {} }), deps);
  await Promise.resolve();
  const second = runCommand(ownerContext({ args: "connect", channel: "webchat", config: {} }), deps);

  releaseStart();
  const replies = await Promise.all([first, second]);
  assert.equal(starts, 1);
  for (const reply of replies) {
    assert.match(reply.text, new RegExp(PAIR_URL.replaceAll("?", "\\?")));
    assert.equal(reply.channelData.openclawPairingQr.setupCode, PAIR_QR_URL);
  }
});

test("repeated connect keeps the ceremony's original expiry", async () => {
  let now = 1_725_000_000_000;
  const { deps } = commandHarness({ deps: { now: () => now } });

  const first = await runCommand(
    ownerContext({ args: "connect", channel: "webchat", config: {} }),
    deps,
  );
  now += 14 * 60 * 1000;
  const repeated = await runCommand(
    ownerContext({ args: "connect", channel: "webchat", config: {} }),
    deps,
  );

  assert.match(first.text, /link expires in 15 minutes/);
  assert.match(repeated.text, /link expires in 1 minute\./);
  assert.match(repeated.presentation.blocks[2].text, /returns the same robot and claim link/);
  assert.equal(
    repeated.channelData.openclawPairingQr.expiresAtMs,
    first.channelData.openclawPairingQr.expiresAtMs,
  );
});

test("the shipped pairing path sends no scope field and preserves a self-hosted path prefix", async () => {
  const calls = [];
  let token;
  const sdk = {
    auth: {
      register: async (body) => {
        calls.push({ path: "/api/agent/auth", body });
        return { credential: "pending_token" };
      },
    },
    setToken: (next) => { token = next; },
  };
  const request = async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify({
      pair_token: "pair_123",
      pair_url: PAIR_URL,
      pair_qr_url: PAIR_QR_URL,
      app_install_url: INSTALL_APP_URL,
      expires_in: 900,
      poll_interval_ms: 1500,
      flow_version: 2,
      claim_mode: "agent_identity",
      agent: {
        id: "agent-1",
        label: "OpenClaw",
        handle: "agt_openclaw",
        profile: { display_name: "OpenClaw", handle: "agt_openclaw" },
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };

  const pairing = await startServerOwnedPairing(sdk, "https://api.pingroom.io/pingroom", "OpenClaw", request);

  assert.equal(pairing.pair_url, PAIR_URL);
  assert.equal(pairing.flow_version, 2);
  assert.equal(pairing.claim_mode, "agent_identity");
  assert.equal(pairing.agent.profile.handle, "agt_openclaw");
  assert.equal(pairing.app_install_url, INSTALL_APP_URL);
  assert.deepEqual(calls[0], {
    path: "/api/agent/auth",
    body: { type: "anonymous", agent_label: "OpenClaw" },
  });
  assert.equal(calls[1].path, "/pingroom/api/agent/auth/pair/start");
  assert.deepEqual(calls[1].body, {});
  assert.equal(Object.hasOwn(calls[0].body, "scopes"), false);
  assert.equal(Object.hasOwn(calls[1].body, "scopes"), false);
  assert.equal(calls[1].headers.Authorization, "Bearer pending_token");
  assert.equal(token, "pending_token");
});

test("connect saves reusable read/install links without cluttering its completion notice", async () => {
  const saved = [];
  const notices = [];
  let finishNotice;
  const noticeSent = new Promise((resolve) => { finishNotice = resolve; });
  const latestPings = "https://api.pingroom.io/api/agent/notifications?limit=25&page=1";
  const { deps } = commandHarness({
    deps: {
      createClient: () => ({
        auth: {
          startPairing: async () => ({
            pair_token: "pair_123",
            pair_url: PAIR_URL,
            pair_qr_url: PAIR_QR_URL,
            expires_in: 900,
            poll_interval_ms: 1500,
          }),
          waitForPairing: async () => ({
            credential: "agent_token",
            handle: "openclaw",
            room: { invite_code: "legacy-room", name: "Legacy" },
            home_room: { invite_code: "room123", name: "Ops" },
            room_access: "all",
            owner: { name: "Mahdi" },
            agent: {
              label: "OpenClaw",
              profile: { display_name: "OpenClaw", handle: "openclaw" },
            },
            links: { latest_pings: latestPings, install_app: INSTALL_APP_URL },
          }),
        },
      }),
      saveCredential: async (credential) => { saved.push(credential); },
      notify: async (text) => {
        notices.push(text);
        finishNotice();
      },
    },
  });

  await runCommand(ownerContext({ args: "connect", channel: "webchat", config: {} }), deps);
  await noticeSent;

  assert.deepEqual(saved, [{
    token: "agent_token",
    defaultRoom: "room123",
    handle: "openclaw",
    links: { latest_pings: latestPings, install_app: INSTALL_APP_URL },
  }]);
  assert.match(notices[0], /OpenClaw @openclaw was claimed by Mahdi and joined #Ops\./);
  assert.match(notices[0], /act for you in all current and future rooms/);
  assert.doesNotMatch(notices[0], /Latest pings:/);
});

test("connect preserves a self-hosted path prefix in the latest-pings fallback", async () => {
  const saved = [];
  let finishNotice;
  const noticeSent = new Promise((resolve) => { finishNotice = resolve; });
  const { deps } = commandHarness({
    deps: {
      createClient: () => ({
        auth: {
          waitForPairing: async () => ({ credential: "agent_token", handle: "openclaw" }),
        },
      }),
      saveCredential: async (credential) => { saved.push(credential); },
      notify: async () => { finishNotice(); },
    },
  });

  await runCommand(ownerContext({
    args: "connect",
    channel: "webchat",
    config: { channels: { pingroom: { baseUrl: "https://self-hosted.test/pingroom/" } } },
  }), deps);
  await noticeSent;

  assert.equal(
    saved[0].links.latest_pings,
    "https://self-hosted.test/pingroom/api/agent/notifications?limit=25&page=1",
  );
  assert.equal(saved[0].links.install_app, INSTALL_APP_URL);
});

test("an expired pairing waiter cannot overwrite its replacement", async () => {
  let now = 1_725_000_000_000;
  const waiters = [];
  const revoked = [];
  const saved = [];
  let clientId = 0;
  const { deps } = commandHarness({
    pairing: { expires_in: 1 },
    deps: {
      now: () => now,
      createClient: () => {
        const id = ++clientId;
        return {
          auth: {
            waitForPairing: () => new Promise((resolve) => { waiters[id] = resolve; }),
            revoke: async () => { revoked.push(id); },
          },
        };
      },
      saveCredential: async (credential) => { saved.push(credential); },
      notify: async () => {},
    },
  });

  await runCommand(ownerContext({ args: "connect", channel: "webchat", config: {} }), deps);
  now += 2_000;
  await runCommand(ownerContext({ args: "connect", channel: "webchat", config: {} }), deps);

  waiters[1]({ credential: "stale_token", handle: "stale" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(saved, []);
  assert.deepEqual(revoked, [1]);
});

test("a credential is revoked when approval succeeds but durable storage fails", async () => {
  let revokeCalls = 0;
  let finishNotice;
  const noticeSent = new Promise((resolve) => { finishNotice = resolve; });
  const { deps } = commandHarness({
    deps: {
      createClient: () => ({
        auth: {
          waitForPairing: async () => ({ credential: "orphan_token", handle: "openclaw" }),
          revoke: async () => { revokeCalls += 1; },
        },
      }),
      saveCredential: async () => { throw new Error("disk full"); },
      notify: async () => { finishNotice(); },
    },
  });

  await runCommand(ownerContext({ args: "connect", channel: "webchat", config: {} }), deps);
  await noticeSent;

  assert.equal(revokeCalls, 1);
});

test("reconnect saves the new credential before revoking the old plugin-owned one", async () => {
  const order = [];
  let finishNotice;
  const noticeSent = new Promise((resolve) => { finishNotice = resolve; });
  const { deps } = commandHarness({
    deps: {
      createClient: () => ({
        auth: {
          waitForPairing: async () => ({
            credential: "new_agent_token",
            handle: "openclaw",
            room_access: "all",
          }),
        },
      }),
      connectedClient: () => ({
        auth: { revoke: async () => { order.push("revoke-old"); } },
      }),
      saveCredential: async ({ token }) => { order.push(`save-${token}`); },
      notify: async () => { order.push("notify"); finishNotice(); },
    },
  });

  await runCommand(ownerContext({
    args: "connect",
    channel: "webchat",
    config: { channels: { pingroom: { token: "old_agent_token" } } },
  }), deps);
  await noticeSent;

  assert.deepEqual(order, ["save-new_agent_token", "revoke-old", "notify"]);
});

test("status keeps the latest-pings URL available after connection", async () => {
  const latestPings = "https://api.pingroom.io/api/agent/notifications?limit=10";
  const reply = await runCommand({
    args: "status",
    senderIsOwner: true,
    channel: "webchat",
    config: { channels: { pingroom: { token: "agent_token", links: { latest_pings: latestPings } } } },
  }, commandHarness().deps);

  assert.match(reply.text, new RegExp(`Latest pings: ${latestPings.replaceAll("?", "\\?")}`));
});

test("connect attaches a managed sensitive PNG on external channels", async () => {
  const { deps, rendered } = commandHarness();

  const reply = await runCommand(
    ownerContext({
      args: "connect",
      channel: "telegram",
      channelId: "telegram",
      sessionKey: "agent:main:telegram:direct:owner",
      config: {},
    }),
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
  assert.equal(reply.presentation.blocks[1].buttons[1].action.url, INSTALL_APP_URL);
});

test("connect describes the expiry reported by the pairing server", async () => {
  const { deps } = commandHarness({
    pairing: { expires_in: 120 },
  });

  const reply = await runCommand(
    ownerContext({
      args: "connect",
      channel: "telegram",
      sessionKey: "agent:main:telegram:direct:owner",
      config: {},
    }),
    deps,
  );

  assert.match(reply.text, /link expires in 2 minutes\./);
  assert.match(reply.presentation.blocks[2].text, /link expires in 2 minutes/);
});

test("connect renders pair_url for servers that predate pair_qr_url", async () => {
  const { deps, rendered } = commandHarness({
    pairing: { pair_qr_url: undefined },
  });

  await runCommand(ownerContext({
    args: "connect",
    channel: "discord",
    sessionKey: "agent:main:discord:direct:owner",
    config: {},
  }), deps);

  assert.deepEqual(rendered, [PAIR_URL]);
});

test("connect keeps its claim link when QR rendering fails", async () => {
  const { deps, errors } = commandHarness({
    deps: {
      renderPairingQr: async () => { throw new Error("renderer unavailable"); },
    },
  });

  const reply = await runCommand(
    ownerContext({
      args: "connect",
      channel: "signal",
      sessionKey: "agent:main:signal:direct:owner",
      config: {},
    }),
    deps,
  );

  assert.equal(reply.mediaUrl, undefined);
  assert.equal(reply.attachments, undefined);
  assert.equal(reply.trustedLocalMedia, undefined);
  assert.equal(reply.sensitiveMedia, undefined);
  assert.deepEqual(errors, ["failed"]);
  assert.match(reply.text, /^Created a PingRoom robot profile for OpenClaw\./);
  assert.match(reply.text, /return before then/);
  assert.match(reply.text, new RegExp(PAIR_URL.replaceAll("?", "\\?")));
  assert.equal(reply.presentation.blocks[1].buttons[0].action.url, PAIR_URL);
  assert.equal(reply.presentation.blocks[1].buttons[1].action.url, INSTALL_APP_URL);
});

test("connect never turns a server-controlled or token-bearing URL into the install action", async () => {
  const { deps } = commandHarness({
    pairing: {
      links: { install_app: `${INSTALL_APP_URL}?token=pair_123` },
    },
  });

  const reply = await runCommand(
    ownerContext({ args: "connect", channel: "webchat", config: {} }),
    deps,
  );

  const install = reply.presentation.blocks[1].buttons[1].action.url;
  assert.equal(install, INSTALL_APP_URL);
  assert.doesNotMatch(install, /pair_123|token=/);
});

test("rooms uses the authenticated production client seam", async () => {
  const reply = await runCommand({
    args: "rooms",
    senderIsOwner: true,
    channel: "webchat",
    config: { channels: { pingroom: { token: "agent_token" } } },
  }, commandHarness({
    deps: {
      createClient: undefined,
      connectedClient: () => ({
        rooms: { list: async () => [{ name: "Ops", invite_code: "ROOM123" }] },
      }),
    },
  }).deps);

  assert.match(reply.text, /Ops — ROOM123/);
});

test("disconnect revokes a plugin-owned credential through the authenticated production client seam", async () => {
  let revokeCalls = 0;
  const saved = [];
  const reply = await runCommand({
    args: "disconnect",
    senderIsOwner: true,
    config: { channels: { pingroom: { token: "agent_token" } } },
  }, commandHarness({
    deps: {
      createClient: undefined,
      connectedClient: () => ({
        auth: { revoke: async () => { revokeCalls += 1; } },
      }),
      saveCredential: async (credential) => { saved.push(credential); },
    },
  }).deps);

  assert.equal(revokeCalls, 1);
  assert.deepEqual(saved, [{ token: "" }]);
  assert.match(reply.text, /credential revoked/);
});

test("disconnect disables but does not revoke an externally sourced credential", async () => {
  let clientCalls = 0;
  const saved = [];
  const reply = await runCommand({
    args: "disconnect",
    senderIsOwner: true,
    config: {
      channels: {
        pingroom: {
          token: { source: "env", provider: "default", id: "PINGROOM_TOKEN" },
        },
      },
    },
  }, commandHarness({
    deps: {
      createClient: undefined,
      connectedClient: () => { clientCalls += 1; throw new Error("must not revoke"); },
      saveCredential: async (credential) => { saved.push(credential); },
    },
  }).deps);

  assert.equal(clientCalls, 0);
  assert.deepEqual(saved, [{ token: "" }]);
  assert.match(reply.text, /disabled locally/);
  assert.match(reply.text, /SecretRef/);
});

test("status honors a locally disabled channel even when an external token still exists", async () => {
  const reply = await runCommand({
    args: "status",
    senderIsOwner: true,
    channel: "webchat",
    config: { channels: { pingroom: { enabled: false, token: "external_token" } } },
  }, commandHarness().deps);

  assert.match(reply.text, /disconnected for this OpenClaw channel/);
});

test("disconnect cancels an open pairing so later approval cannot re-enable the channel", async () => {
  let approve;
  const saved = [];
  const revoked = [];
  const { deps } = commandHarness({
    deps: {
      createClient: () => ({
        auth: {
          waitForPairing: () => new Promise((resolve) => { approve = resolve; }),
          revoke: async () => { revoked.push("new"); },
        },
      }),
      saveCredential: async (credential) => { saved.push(credential); },
      notify: async () => {},
    },
  });

  const config = { channels: { pingroom: { useCliCredential: false } } };
  await runCommand(ownerContext({ args: "connect", channel: "webchat", config }), deps);
  const reply = await runCommand(ownerContext({ args: "disconnect", channel: "webchat", config }), deps);
  approve({ credential: "late_token", handle: "late" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(reply.text, /connection cancelled/i);
  assert.deepEqual(saved, [{ token: "" }]);
  assert.deepEqual(revoked, ["new"]);
});

test("disconnect wins when approval is already blocked inside credential storage", async () => {
  let saveStarted;
  let releaseSave;
  const enteredSave = new Promise((resolve) => { saveStarted = resolve; });
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const saved = [];
  let revokeCalls = 0;
  const { deps } = commandHarness({
    deps: {
      createClient: () => ({
        auth: {
          waitForPairing: async () => ({ credential: "new_token", handle: "openclaw" }),
          revoke: async () => { revokeCalls += 1; },
        },
      }),
      saveCredential: async (credential) => {
        saved.push(credential);
        if (credential.token === "new_token") {
          saveStarted();
          await saveGate;
        }
      },
      notify: async () => {},
    },
  });
  const config = { channels: { pingroom: { useCliCredential: false } } };

  await runCommand(ownerContext({ args: "connect", channel: "webchat", config }), deps);
  await enteredSave;
  const disconnecting = runCommand(
    ownerContext({ args: "disconnect", channel: "webchat", config }),
    deps,
  );

  releaseSave();
  const reply = await disconnecting;

  assert.match(reply.text, /connection cancelled/i);
  assert.deepEqual(saved.map(({ token }) => token), ["new_token", ""]);
  assert.equal(revokeCalls, 1);
});

// The plugin's credential lives in channels.pingroom, which the `pingroom
// activate` CLI command cannot read — it refuses --token and reads only its
// own credentials.json. So the plugin runs the ceremony itself.
test("activate runs the inbox ceremony with the plugin's own credential", async () => {
  const notices = [];
  let sent;
  const noticeSent = new Promise((resolve) => { sent = resolve; });
  let activateCalls = 0;
  const { deps } = commandHarness({
    deps: {
      connectedClient: () => ({
        inbox: {
          activate: async () => { activateCalls += 1; return { activation_completed: true }; },
        },
      }),
      notify: async (text) => { notices.push(text); sent(); },
    },
  });

  const reply = await runCommand(ownerContext({
    args: "activate",
    channel: "webchat",
    config: { channels: { pingroom: { token: "agent_token" } } },
  }), deps);
  await noticeSent;

  assert.match(reply.text, /Check your phone/);
  assert.equal(activateCalls, 1);
  assert.match(notices[0], /verified/);
});

test("activate turns recipient_not_ready into install guidance and keeps the connection", async () => {
  const notices = [];
  let sent;
  const noticeSent = new Promise((resolve) => { sent = resolve; });
  const { deps } = commandHarness({
    deps: {
      connectedClient: () => ({
        inbox: {
          activate: async () => {
            throw Object.assign(new Error("no device"), { code: "recipient_not_ready" });
          },
        },
      }),
      notify: async (text) => { notices.push(text); sent(); },
    },
  });

  await runCommand(ownerContext({
    args: "activate",
    channel: "webchat",
    config: { channels: { pingroom: { token: "agent_token" } } },
  }), deps);
  await noticeSent;

  assert.match(notices[0], new RegExp(INSTALL_APP_URL.replaceAll("/", "\\/")));
  assert.match(notices[0], /\/pingroom activate again/);
  assert.match(notices[0], /connection itself is saved and usable/);
});

test("activate refuses a caller who is not the owner and never touches the API", async () => {
  let activateCalls = 0;
  const { deps } = commandHarness({
    deps: {
      connectedClient: () => ({
        inbox: { activate: async () => { activateCalls += 1; return {}; } },
      }),
    },
  });

  const reply = await runCommand({
    args: "activate",
    senderIsOwner: false,
    channel: "webchat",
    config: { channels: { pingroom: { token: "agent_token" } } },
  }, deps);

  assert.match(reply.text, /Only the account owner/);
  assert.equal(activateCalls, 0);
});

test("activate tells a disconnected channel to connect first", async () => {
  // useCliCredential:false matters here — without it the config-less account
  // resolves through the developer's own ~/.pingroom/credentials.json and the
  // command looks connected on a maintainer's machine but not in CI.
  const reply = await runCommand(
    ownerContext({
      args: "activate",
      channel: "webchat",
      config: { channels: { pingroom: { useCliCredential: false } } },
    }),
    commandHarness().deps,
  );

  assert.match(reply.text, /Run \/pingroom connect/);
});
