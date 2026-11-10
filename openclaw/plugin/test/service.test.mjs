import test from "node:test";
import assert from "node:assert/strict";
import { PingRoomAccountService } from "../dist/service.js";

const ping = (id) => ({ id, message: `message ${id}`, trigger_source: "manual" });

/**
 * A service wired to a scripted or cursor-aware long-poll. Missing replies
 * leave `wait` hanging until the service stops.
 */
function harness(script, onPing) {
  const waits = [];
  const logs = { warn: [], error: [] };
  const sdk = {
    questions: { list: async () => ({ questions: [] }) },
    notifications: {
      wait: (options) => {
        waits.push(options);
        const next = typeof script === "function" ? script(options, waits.length) : script.shift();
        if (next) return Promise.resolve(next);
        return new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    },
  };
  const service = new PingRoomAccountService({
    account: { inboundEnabled: true, pollTimeoutSeconds: 1 },
    log: { info() {}, warn: (m) => logs.warn.push(m), error: (m) => logs.error.push(m) },
    onPing: async (event) => onPing(event.id),
    onQuestionResolved: async () => {},
    acceptsMarker: () => true,
    sdk,
  });
  return { service, waits, logs };
}

const until = async (predicate) => {
  for (let i = 0; i < 600; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("expected background work did not arrive");
};

test("a Ping whose handler keeps throwing is dropped after a bounded retry and never stalls the Pings behind it", async () => {
  const delivered = [];
  const attempts = { A: 0 };
  const { service, waits, logs } = harness(
    [
      { notifications: [ping("A"), ping("B")], cursor: "c1" },
      { notifications: [ping("A"), ping("B")], cursor: "c1" },
      { notifications: [ping("A"), ping("B")], cursor: "c1" },
      { notifications: [ping("C")], cursor: "c2" },
    ],
    (id) => {
      if (id === "A") {
        attempts.A += 1;
        throw new Error("runtime rejected the session");
      }
      delivered.push(id);
    },
  );
  await service.start();
  try {
    await until(() => delivered.includes("C"));
    assert.deepEqual(delivered, ["B", "C"]);
    assert.equal(attempts.A, 3);
    assert.equal(waits[0].after, undefined);
    assert.equal(waits.at(-1).after, "c2");
    assert.equal(waits.filter((w) => w.after === undefined).length, 3, "the first batch is fetched once per attempt, then the cursor moves");
    assert.ok(logs.error.some((m) => m.includes("giving up on ping:A")), logs.error.join("\n"));
  } finally {
    await service.stop();
  }
});

test("a Ping whose handler fails once is retried on the same cursor and delivered exactly once", async () => {
  const delivered = [];
  let calls = 0;
  const { service, waits } = harness(
    [
      { notifications: [ping("A"), ping("B")], cursor: "c1" },
      { notifications: [ping("A"), ping("B")], cursor: "c1" },
    ],
    (id) => {
      if (id === "A" && (calls += 1) === 1) throw new Error("transient");
      delivered.push(id);
    },
  );
  await service.start();
  try {
    await until(() => waits.length >= 3);
    assert.deepEqual(delivered, ["B", "A"]);
    assert.equal(waits[1].after, undefined, "the cursor holds while a retry is owed");
    assert.equal(waits[2].after, "c1", "and moves once the batch is clean");
  } finally {
    await service.stop();
  }
});

test("staggered failing Pings keep their exhausted retry budgets while another Ping holds the cursor", async () => {
  const delivered = [];
  const attempts = { A: 0, B: 0 };
  const { service, waits, logs } = harness(
    ({ after }, count) => {
      if (count === 1) return { notifications: [], cursor: "c0" };
      if (after === "cB") return { notifications: [ping("C")], cursor: "cC" };
      if (after === "cC") return undefined;
      assert.equal(after, "c0");
      // B arrives after A's first failure, so its retry budget expires later.
      return count === 2
        ? { notifications: [ping("A")], cursor: "cA" }
        : { notifications: [ping("A"), ping("B")], cursor: "cB" };
    },
    (id) => {
      if (id === "A" || id === "B") {
        attempts[id] += 1;
        throw new Error("permanent handler failure");
      }
      delivered.push(id);
    },
  );
  await service.start();
  try {
    await until(() => waits.at(-1).after === "cC");
    assert.deepEqual(attempts, { A: 3, B: 3 });
    assert.deepEqual(delivered, ["C"]);
    assert.deepEqual(waits.map(({ after }) => after), [undefined, "c0", "c0", "c0", "c0", "cB", "cC"]);
    assert.equal(logs.error.filter((message) => message.includes("giving up on ping:A")).length, 1);
    assert.equal(logs.error.filter((message) => message.includes("giving up on ping:B")).length, 1);
  } finally {
    await service.stop();
  }
});
