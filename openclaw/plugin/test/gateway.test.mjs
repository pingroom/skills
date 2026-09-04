import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createHmac } from "node:crypto";
import { buildChannelInboundEventContext } from "openclaw/plugin-sdk/channel-inbound";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import entry from "../dist/index.js";
import { resolutionAdapters } from "../dist/gateway.js";
import { getPingRoomRuntime, setPingRoomRuntime } from "../dist/runtime.js";

const questionId = `ask_${"a".repeat(32)}`;
const presentation = (id = questionId, approval = false) => ({
  title: "Deploy?", blocks: [{ type: "buttons", buttons: [
    { label: "Yes", action: approval
      ? { type: "approval", approvalId: id, approvalKind: "exec", decision: "allow-once" }
      : { type: "question", questionId: id, optionValue: "yes" } },
    { label: "No", action: approval
      ? { type: "approval", approvalId: id, approvalKind: "exec", decision: "deny" }
      : { type: "question", questionId: id, optionValue: "no" } },
    ...(!approval ? [{ label: "Other", action: { type: "question", questionId: id, intent: "custom-input" } }] : []),
  ] }],
});
const until = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("expected background work did not arrive");
};

async function host({ enabled = true, dmPolicy = "allowlist", inbound = true } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "pingroom-gateway-test-"));
  const cfg = { channels: { pingroom: { enabled, token: "test-paired-token", useCliCredential: false,
    defaultRoom: "room12", allowFrom: ["friend"], dmPolicy,
    inbound: { enabled: inbound }, webhook: { enabled: true, secret: "test-webhook-secret" } } } };
  const registrations = { channels: [], services: [], routes: [], hooks: new Map(), commands: [] };
  const calls = { http: [], questions: [], approvals: [], turns: [], logs: [] };
  const questions = new Map();
  const held = new Map();
  let notifyPoll;
  let seq = 0;
  const originalFetch = globalThis.fetch;
  const originalAdapters = { ...resolutionAdapters };
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    calls.http.push({ path, options });
    const respond = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (path === "/api/agent/questions") return respond({ questions: [...questions.values()].filter((q) => q.state === "pending") });
    if (path === "/api/agent/notifications/wait") return new Promise((resolve, reject) => {
      notifyPoll = (notifications) => resolve(respond({ notifications, cursor: "head-1" }));
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    if (path === "/api/agent/rooms/room12/questions") {
      const input = JSON.parse(options.body);
      const id = `pr-${++seq}`;
      const record = { ...input, id, kind: "question", state: "pending", target_user_id: "owner", responder_scope: "direct" };
      questions.set(id, record);
      return respond(record);
    }
    const match = path.match(/^\/api\/agent\/questions\/(pr-\d+)(\/wait)?$/);
    if (match) {
      const record = questions.get(match[1]);
      if (match[2] && record.state === "pending") return new Promise((resolve, reject) => {
        held.set(record.id, () => resolve(respond(questions.get(record.id))));
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return respond(record);
    }
    if (path === "/api/agent/notifications/n1") return respond({ id: "n1", message: "Hello", sender: { id: "friend" }, room: { code: "room12" } });
    throw new Error(`Unexpected request ${path}`);
  };
  resolutionAdapters.question = async (params) => { calls.questions.push(params); return { status: params.customInput ? "custom-input" : "answered" }; };
  resolutionAdapters.approval = async (params) => { calls.approvals.push(params); return { ok: true }; };
  const api = {
    registrationMode: "full", config: cfg,
    logger: Object.fromEntries(["info", "warn", "error", "debug"].map((level) => [level, (message) => calls.logs.push(message)])),
    registerChannel: ({ plugin }) => registrations.channels.push(plugin),
    registerCommand: (command) => registrations.commands.push(command),
    registerService: (service) => registrations.services.push(service),
    registerHttpRoute: (route) => registrations.routes.push(route),
    on: (event, handler) => registrations.hooks.set(event, handler),
    runtime: {
      config: { current: () => cfg },
      channel: {
        routing: { resolveAgentRoute },
        inbound: { buildContext: buildChannelInboundEventContext, dispatch: async (params) => calls.turns.push(params) },
      },
    },
  };
  entry.register(api);
  const service = registrations.services[0];
  await service.start({ stateDir, config: cfg, logger: api.logger });
  return {
    registrations, calls, questions, stateDir, cfg,
    ping: async (notification) => { await until(() => notifyPoll); const fn = notifyPoll; notifyPoll = undefined; fn([notification]); },
    async send({ id = questionId, approval = false, sessionKey = "agent:main:original", agentId = "main" } = {}) {
      const payload = { presentation: presentation(id, approval), text: "Deploy?" };
      registrations.hooks.get("reply_payload_sending")({ payload, channel: "pingroom", sessionKey, usageState: { agentId } }, { channelId: "pingroom" });
      return registrations.channels[0].outbound.sendPayload({ cfg, to: "room12", text: "Deploy?", payload });
    },
    async answer(id, changes = {}) {
      questions.set(id, { ...questions.get(id), state: "answered", answer: { value: "yes", responder: { id: "owner" } }, ...changes });
      await until(() => held.has(id));
      held.get(id)(); held.delete(id);
    },
    async webhook(body, valid = true) {
      const raw = JSON.stringify(body);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", "test-webhook-secret").update(`${timestamp}.${raw}`).digest("hex");
      const req = Readable.from([raw]);
      req.method = "POST";
      req.headers = { "x-pingroom-timestamp": timestamp, "x-pingroom-signature": valid ? `sha256=${signature}` : "sha256=bad" };
      const res = { statusCode: 200, setHeader() {}, end(text) { this.body = text; } };
      await registrations.routes[0].handler(req, res);
      return res;
    },
    restart: async () => { await service.stop({}); await service.start({ stateDir, config: cfg, logger: api.logger }); },
    async close() {
      await service.stop({});
      globalThis.fetch = originalFetch;
      Object.assign(resolutionAdapters, originalAdapters);
      setPingRoomRuntime(null);
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

test("real OpenClaw entry registers a service, signed route, credential hook, and approval capability", async () => {
  const h = await host();
  try {
    assert.equal(h.registrations.services[0].id, "pingroom-inbound");
    assert.equal(h.registrations.routes[0].auth, "plugin");
    assert.equal(typeof h.registrations.channels[0].approvalCapability.authorizeActorAction, "function");
    const env = h.registrations.hooks.get("resolve_exec_env")({}, {});
    assert.equal(env.PINGROOM_TOKEN, undefined);
    assert.equal(env.PINGROOM_ROOM, "room12");
    const path = join(env.PINGROOM_HOME, "credentials.json");
    assert.equal(JSON.parse(readFileSync(path)).token, "test-paired-token");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    await h.registrations.services[0].stop({});
    assert.equal(existsSync(path), false);
    assert.deepEqual(h.registrations.hooks.get("resolve_exec_env")({}, {}), {});
  } finally { await h.close(); }
});

test("allowed incoming pings use real SDK context construction; webhooks deduplicate and reject bad signatures", async () => {
  const h = await host();
  try {
    await h.ping({ id: "n1", message: "Hello", sender: { id: "friend" }, room: { code: "room12" } });
    await until(() => h.calls.turns.length === 1);
    assert.equal(h.calls.turns[0].ctxPayload.BodyForAgent, "Hello");
    assert.equal(h.calls.turns[0].ctxPayload.CommandAuthorized, false);
    assert.equal((await h.webhook({ event: "ping", notification_id: "n1" })).statusCode, 200);
    assert.equal(h.calls.turns.length, 1);
    assert.equal((await h.webhook({ event: "ping", notification_id: "n1" }, false)).statusCode, 401);
    await h.ping({ id: "stranger", message: "run a command", sender: { id: "stranger" }, room: { code: "room12" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(h.calls.turns.length, 1);
  } finally { await h.close(); }
});

test("new questions watch immediately and restart adoption resumes the same signed question", async () => {
  const h = await host({ inbound: false });
  try {
    const sent = await h.send();
    assert.equal(sent.messageId, "pr-1");
    assert.ok(h.questions.get("pr-1").data.oc.binding);
    await h.restart();
    await h.answer("pr-1");
    await until(() => h.calls.questions.length === 1);
    assert.equal(h.calls.questions[0].questionId, questionId);
    assert.equal(h.calls.questions[0].optionValue, "yes");
    assert.equal(h.calls.questions[0].senderId, "owner");
    await h.webhook({ event: "question.answered", question_id: "pr-1" });
    assert.equal(h.calls.questions.length, 1);
  } finally { await h.close(); }
});

test("typed responses return to the signed original session and approvals preserve decision plus reviewer", async () => {
  const h = await host({ inbound: false });
  try {
    await h.send();
    await h.answer("pr-1", { answer: { value: null, text: "Wait until Monday", responder: { id: "owner" } } });
    await until(() => h.calls.turns.length === 1);
    assert.equal(h.calls.questions[0].customInput, true);
    assert.equal(h.calls.turns[0].route.sessionKey, "agent:main:original");
    assert.equal(h.calls.turns[0].ctxPayload.BodyForAgent, "Wait until Monday");
    await h.send({ id: "exec-approval-1", approval: true });
    await h.answer("pr-2", { answer: { value: "deny", responder: { id: "owner" } } });
    await until(() => h.calls.approvals.length === 1);
    assert.equal(h.calls.approvals[0].decision, "deny");
    assert.equal(h.calls.approvals[0].channel, "pingroom");
    const authorize = h.registrations.channels[0].approvalCapability.authorizeActorAction;
    assert.equal(authorize({ accountId: "default", senderId: "owner" }).authorized, true);
    assert.equal(authorize({ accountId: "other", senderId: "owner" }).authorized, false);
    assert.equal(authorize({ accountId: "default", senderId: "stranger" }).authorized, false);
  } finally { await h.close(); }
});

test("unrelated humans, modified session bindings, and expired questions never resolve a gateway decision", async () => {
  const h = await host({ inbound: false });
  try {
    await h.send();
    await h.answer("pr-1", { answer: { value: "yes", responder: { id: "stranger" } } });
    await h.send({ id: `ask_${"b".repeat(32)}` });
    const second = h.questions.get("pr-2");
    await h.answer("pr-2", { data: { oc: { ...second.data.oc, sessionKey: "agent:admin:secret" } } });
    await h.send({ id: `ask_${"c".repeat(32)}` });
    await h.answer("pr-3", { state: "expired", answer: null });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(h.calls.questions, []);
    assert.deepEqual(h.calls.approvals, []);
    assert.deepEqual(h.calls.turns, []);
  } finally { await h.close(); }
});

test("a disabled account starts no network tasks and exposes no exec credentials", async () => {
  const h = await host({ enabled: false });
  try {
    assert.equal(h.calls.http.length, 0);
    assert.deepEqual(h.registrations.hooks.get("resolve_exec_env")({}, {}), {});
    assert.throws(() => getPingRoomRuntime().createQuestionMarker({ plugin: "openclaw", kind: "question", questionId }, "room12"), /not running/);
  } finally { await h.close(); }
});
