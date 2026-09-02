import test from "node:test";
import assert from "node:assert/strict";
import { dedupeKey, fromWebhook, isConversational, renderInboundText } from "../dist/inbound/events.js";

test("the agent's own pings are never fed back to it", () => {
  // origin_agent is how the server marks a ping this credential created.
  assert.equal(isConversational({ id: "n1", origin_agent: { handle: "agt_x" } }), false);
});

test("platform traffic is not conversation", () => {
  for (const trigger_source of ["agent", "agent_question", "agent_approval", "agent_live", "user_live", "system"]) {
    assert.equal(isConversational({ id: "n", trigger_source }), false, trigger_source);
  }
  assert.equal(isConversational({ id: "n", question: { id: "q" } }), false, "a Question is answered, not replied to");
  assert.equal(isConversational({ id: "n", is_handoff: true }), false);
});

test("a person's ping in a shared room is conversation", () => {
  assert.equal(isConversational({ id: "n", trigger_source: "manual", sender: { id: "u1" } }), true);
});

test("inbound text carries the title, link, location, and attachment names", () => {
  const text = renderInboundText({
    id: "n",
    notification_title: "Build",
    message: "failed on main",
    data: { url: "https://ci.test/7", location: { label: "Office", latitude: 25.2, longitude: 55.3 } },
    attachments: [{ filename: "log.txt" }],
  });
  assert.match(text, /Build: failed on main/);
  assert.match(text, /https:\/\/ci\.test\/7/);
  assert.match(text, /Office 25\.2,55\.3/);
  assert.match(text, /log\.txt/);
});

test("an empty ping still renders something an agent can read", () => {
  assert.equal(renderInboundText({ id: "n" }), "(empty ping)");
});

test("poll and webhook delivery of the same fact share one dedupe key", () => {
  const polled = { type: "ping", id: "n1", notification: { id: "n1" } };
  const hooked = fromWebhook({ event: "ping", notification_id: "n1", body: "hi" });
  assert.equal(dedupeKey(polled), dedupeKey(hooked));
});

test("question lifecycle keys include the state, so answered and expired are distinct", () => {
  const answered = fromWebhook({ event: "question.answered", question_id: "q1" });
  const expired = fromWebhook({ event: "question.expired", question_id: "q1" });
  assert.notEqual(dedupeKey(answered), dedupeKey(expired));
  assert.equal(answered.state, "answered");
});

test("an unrecognized webhook event is ignored rather than mishandled", () => {
  assert.equal(fromWebhook({ event: "something.new", notification_id: "n" }), null);
  assert.equal(fromWebhook({}), null);
});
