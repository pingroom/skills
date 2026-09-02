import test from "node:test";
import assert from "node:assert/strict";
import { adoptPendingQuestions, readMarker, readResolution } from "../dist/inbound/questions.js";

const marker = { plugin: "openclaw", kind: "question", questionId: "q-oc" };

test("a tapped option resolves the ask_user question", () => {
  const resolution = readResolution({
    state: "answered",
    answer: { value: "staging", responder: { id: "u1" } },
    data: { oc: marker },
  });
  assert.equal(resolution.state, "answered");
  assert.equal(resolution.optionValue, "staging");
  assert.equal(resolution.responderId, "u1");
  assert.equal(resolution.marker.questionId, "q-oc");
});

test("a typed answer is text, not a fabricated option", () => {
  const resolution = readResolution({
    state: "answered",
    answer: { value: null, text: "neither, hold off" },
    data: { oc: marker },
  });
  assert.equal(resolution.optionValue, undefined);
  assert.equal(resolution.text, "neither, hold off");
});

test("expiry and cancellation are terminal but are NOT answers", () => {
  for (const state of ["expired", "cancelled"]) {
    const resolution = readResolution({ state, data: { oc: marker } });
    assert.equal(resolution.state, state);
    assert.equal(resolution.optionValue, undefined);
    assert.equal(resolution.text, undefined);
  }
});

test("a still-pending question resolves nothing", () => {
  assert.equal(readResolution({ state: "pending", data: { oc: marker } }), null);
});

test("a question this plugin did not create is ignored", () => {
  assert.equal(readResolution({ state: "answered", answer: { value: "x" }, data: {} }), null);
  assert.equal(readResolution({ state: "answered", answer: { value: "x" }, data: { oc: { plugin: "other" } } }), null);
  assert.equal(readMarker({ oc: { plugin: "openclaw", kind: "approval", approvalId: "a1" } }).approvalId, "a1");
});

test("open questions are re-adopted from the server after a restart", async () => {
  // The mapping lives on the Question, so there is no local state to lose.
  const sdk = {
    questions: {
      list: async () => ({
        questions: [
          { id: "pr1", data: { oc: marker } },
          { id: "pr2", data: {} },
          { id: "pr3", data: { oc: { plugin: "openclaw", kind: "approval", approvalId: "a9" } } },
        ],
      }),
    },
  };
  const adopted = await adoptPendingQuestions(sdk);
  assert.deepEqual(adopted.map((a) => a.pingroomQuestionId), ["pr1", "pr3"]);
  assert.equal(adopted[1].marker.approvalId, "a9");
});
