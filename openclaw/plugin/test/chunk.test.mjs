import test from "node:test";
import assert from "node:assert/strict";
import { splitForPing } from "../dist/outbound/chunk.js";

test("a short reply is one ping with no title", () => {
  const out = splitForPing("Deploy finished, 3 services green.");
  assert.deepEqual(out.messages, ["Deploy finished, 3 services green."]);
  assert.equal(out.title, undefined);
  assert.equal(out.truncated, false);
});

test("a short opening line becomes the title, which does not spend the body budget", () => {
  const out = splitForPing("Deploy finished\nAll three services are green and traffic is steady.");
  assert.equal(out.title, "Deploy finished");
  assert.equal(out.messages[0], "All three services are green and traffic is steady.");
});

test("a long first line is body text, not a title", () => {
  const long = "x".repeat(60);
  const out = splitForPing(`${long}\nmore`);
  assert.equal(out.title, undefined);
  assert.match(out.messages[0], /^x+/);
});

test("every chunk fits the ping limit", () => {
  const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about the deploy.`).join(" ");
  const out = splitForPing(text, { maxChunks: 3 });
  assert.ok(out.messages.length <= 3);
  for (const m of out.messages) assert.ok(m.length <= 120, `chunk too long: ${m.length}`);
});

test("overflow is marked, not silently dropped", () => {
  const text = "word ".repeat(200);
  const out = splitForPing(text, { maxChunks: 1 });
  assert.equal(out.messages.length, 1);
  assert.equal(out.truncated, true);
  assert.ok(out.messages[0].endsWith("…"));
  assert.equal(out.originalLength, text.trim().length);
});

test("it breaks on a sentence end rather than mid-word", () => {
  const text = `${"a".repeat(70)}. ${"b".repeat(200)}`;
  const [first] = splitForPing(text, { maxChunks: 2 }).messages;
  assert.ok(first.endsWith("."), `expected a sentence break, got: ${first.slice(-20)}`);
});

test("empty input produces no pings at all", () => {
  assert.deepEqual(splitForPing("   \n  ").messages, []);
});
