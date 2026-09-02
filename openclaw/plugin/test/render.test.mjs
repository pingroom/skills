import test from "node:test";
import assert from "node:assert/strict";
import { planFromPresentation } from "../dist/outbound/render.js";

const buttons = (...list) => ({ blocks: [{ type: "buttons", buttons: list }] });

test("an ask_user question becomes a PingRoom Question", () => {
  const plan = planFromPresentation({
    title: "Deploy target?",
    blocks: [
      { type: "context", text: "build 412" },
      { type: "buttons", buttons: [
        { label: "Staging", action: { type: "question", questionId: "q1", optionValue: "staging" } },
        { label: "Production", style: "danger", action: { type: "question", questionId: "q1", optionValue: "prod" } },
      ] },
    ],
  });
  assert.equal(plan.kind, "question");
  assert.equal(plan.questionId, "q1");
  assert.equal(plan.prompt, "Deploy target?");
  assert.equal(plan.context, "build 412");
  assert.equal(plan.allowText, false);
  assert.deepEqual(plan.options.map((o) => o.value), ["staging", "prod"]);
  assert.equal(plan.options[1].style, "danger");
});

test("a custom-input button opts the Question into a typed answer", () => {
  const plan = planFromPresentation(buttons(
    { label: "Yes", action: { type: "question", questionId: "q2", optionValue: "yes" } },
    { label: "No", action: { type: "question", questionId: "q2", optionValue: "no" } },
    { label: "Other…", action: { type: "question", questionId: "q2", intent: "custom-input" } },
  ));
  assert.equal(plan.kind, "question");
  assert.equal(plan.allowText, true);
  assert.equal(plan.options.length, 2, "custom-input is not an option");
});

test("an approval keeps its id and kind so the decision can be resolved", () => {
  const plan = planFromPresentation(buttons(
    { label: "Allow once", style: "primary", action: { type: "approval", approvalId: "a1", approvalKind: "exec", decision: "allow-once" } },
    { label: "Deny", action: { type: "approval", approvalId: "a1", approvalKind: "exec", decision: "deny" } },
  ));
  assert.equal(plan.kind, "approval");
  assert.equal(plan.approvalId, "a1");
  assert.equal(plan.approvalKind, "exec");
  // deny defaults to the danger style even when the button did not say so
  assert.equal(plan.options.find((o) => o.value === "deny").style, "danger");
});

test("a lone url button becomes a link ping", () => {
  const plan = planFromPresentation(buttons(
    { label: "Open the PR", action: { type: "url", url: "https://example.test/pr/7" } },
  ));
  assert.equal(plan.kind, "link");
  assert.equal(plan.url, "https://example.test/pr/7");
  assert.equal(plan.buttonLabel, "Open the PR");
});

test("callback and command actions fall back to text rather than being reinterpreted", () => {
  // OpenClaw's contract: callback data is opaque plugin state and a channel
  // must not turn it into anything else.
  assert.equal(planFromPresentation(buttons({ label: "X", action: { type: "callback", value: "opaque" } })).kind, "text");
  assert.equal(planFromPresentation(buttons({ label: "X", action: { type: "command", command: "/status" } })).kind, "text");
});

test("mixed and unrepresentable shapes fall back to text", () => {
  // two different questions
  assert.equal(planFromPresentation(buttons(
    { label: "A", action: { type: "question", questionId: "q1", optionValue: "a" } },
    { label: "B", action: { type: "question", questionId: "q2", optionValue: "b" } },
  )).kind, "text");
  // a question plus a link
  assert.equal(planFromPresentation(buttons(
    { label: "A", action: { type: "question", questionId: "q1", optionValue: "a" } },
    { label: "Docs", action: { type: "url", url: "https://example.test" } },
  )).kind, "text");
  // a select cannot be a Question
  assert.equal(planFromPresentation({ blocks: [{ type: "select", options: [] }] }).kind, "text");
  // one option is not a choice
  assert.equal(planFromPresentation(buttons(
    { label: "Only", action: { type: "question", questionId: "q1", optionValue: "only" } },
  )).kind, "text");
});

test("no presentation at all is plain text", () => {
  assert.equal(planFromPresentation(null).kind, "text");
  assert.equal(planFromPresentation({}).kind, "text");
});

test("labels and values are clamped to what PingRoom accepts", () => {
  const plan = planFromPresentation(buttons(
    { label: "L".repeat(80), action: { type: "question", questionId: "q", optionValue: "v".repeat(80) } },
    { label: "Second", action: { type: "question", questionId: "q", optionValue: "second" } },
  ));
  assert.ok(plan.options[0].label.length <= 40);
  assert.ok(plan.options[0].value.length <= 40);
});
