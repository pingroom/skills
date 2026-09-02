import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyAndNormalize } from "../dist/inbound/webhook.js";

const SECRET = "whsec_test";

function signed(body, { deliveryId = "d1", timestamp = String(Math.floor(Date.now() / 1000)) } = {}) {
  const v2 = createHmac("sha256", SECRET).update(`v2\n${timestamp}\n${deliveryId}\n${body}`).digest("hex");
  return {
    "x-pingroom-timestamp": timestamp,
    "x-pingroom-delivery": deliveryId,
    "x-pingroom-signature-v2": v2,
  };
}

test("a correctly signed ping is accepted and normalized", async () => {
  const body = JSON.stringify({ event: "ping", notification_id: "n1", body: "Deploy done", title: "CI" });
  const result = await verifyAndNormalize(body, signed(body), SECRET);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.event.type, "ping");
  assert.equal(result.event.id, "n1");
});

test("a tampered delivery id fails, because v2 binds it", async () => {
  const body = JSON.stringify({ event: "ping", notification_id: "n1" });
  const headers = signed(body);
  headers["x-pingroom-delivery"] = "someone-elses-id";
  const result = await verifyAndNormalize(body, headers, SECRET);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("a modified body fails even with the original signature", async () => {
  const body = JSON.stringify({ event: "ping", notification_id: "n1" });
  const headers = signed(body);
  const result = await verifyAndNormalize(body.replace("n1", "n2"), headers, SECRET);
  assert.equal(result.ok, false);
});

test("the wrong secret fails", async () => {
  const body = JSON.stringify({ event: "ping", notification_id: "n1" });
  const result = await verifyAndNormalize(body, signed(body), "whsec_other");
  assert.equal(result.ok, false);
});

test("missing signature headers are refused before any parsing", async () => {
  const result = await verifyAndNormalize("{}", {}, SECRET);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("a signed body that is not JSON is a 400, not a crash", async () => {
  const body = "not json";
  const result = await verifyAndNormalize(body, signed(body), SECRET);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("a signed event this plugin ignores still answers 200", async () => {
  // Anything but 200 makes PingRoom retry the delivery three times for nothing.
  const body = JSON.stringify({ event: "something.new", notification_id: "n1" });
  const result = await verifyAndNormalize(body, signed(body), SECRET);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.event, undefined);
});
