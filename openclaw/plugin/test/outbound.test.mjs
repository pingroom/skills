import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pingroomChannelPlugin } from "../dist/channel.js";
import { setPingRoomRuntime } from "../dist/runtime.js";

function setup(t, { uploadStatus = 200, ...config } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pingroom-outbound-test-"));
  const cfg = { channels: { pingroom: {
    enabled: true, token: "test-paired-token", useCliCredential: false,
    defaultRoom: "room12", urgency: "urgent", requireAck: true, ...config,
  } } };
  const calls = { uploads: [], broadcasts: [], questions: [], watched: [] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    const respond = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (path === "/api/agent/attachments") {
      const file = options.body.get("file");
      calls.uploads.push({ name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
      return uploadStatus === 200
        ? respond({ attachment: { id: `attachment-${calls.uploads.length}` } })
        : respond({ code: "pro_required", message: "Attachments require Pro." }, uploadStatus);
    }
    if (path === "/api/agent/rooms/room12/notifications") {
      calls.broadcasts.push(JSON.parse(options.body));
      return respond({ id: `ping-${calls.broadcasts.length}` });
    }
    if (path === "/api/agent/rooms/room12/questions") {
      calls.questions.push(JSON.parse(options.body));
      return respond({ id: "question-1" });
    }
    throw new Error(`Unexpected request ${path}`);
  };
  setPingRoomRuntime({
    getConfig: () => cfg,
    createQuestionMarker: (marker, room) => ({ ...marker, room }),
    watchQuestion: (id) => calls.watched.push(id),
  });
  t.after(() => {
    setPingRoomRuntime(null);
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    calls, directory,
    params: { cfg, to: "room12", text: "", replyToId: "original-ping", mediaLocalRoots: [directory] },
    file(name, contents = "Report contents") {
      const path = join(directory, name);
      writeFileSync(path, contents);
      return path;
    },
  };
}

const link = { blocks: [{ type: "buttons", buttons: [
  { label: "Open report", action: { type: "url", url: "https://example.com/report" } },
] }] };

test("URL-button replies preserve urgency, acknowledgement, and the reply pointer", async (t) => {
  const h = setup(t);
  await pingroomChannelPlugin.outbound.sendPayload({
    ...h.params, text: "Read report", payload: { presentation: link },
  });
  assert.deepEqual(h.calls.broadcasts, [{
    message: "Read report", is_urgent: true, requires_ack: true, reply_to: "original-ping",
    data: { url: "https://example.com/report", button_label: "Open report" },
  }]);
});

test("the composed host sendMedia adapter uploads a file and sends a media-only Ping", async (t) => {
  const h = setup(t);
  assert.equal(typeof pingroomChannelPlugin.outbound.sendMedia, "function");
  const result = await pingroomChannelPlugin.outbound.sendMedia({
    ...h.params, mediaUrl: h.file("report.txt"),
  });
  assert.deepEqual(result, { channel: "pingroom", messageId: "ping-1" });
  assert.deepEqual(h.calls.uploads, [{ name: "report.txt", type: "text/plain", bytes: Buffer.from("Report contents") }]);
  assert.deepEqual(h.calls.broadcasts, [{
    message: "Attachment", attachment_ids: ["attachment-1"],
    is_urgent: true, requires_ack: true, reply_to: "original-ping",
  }]);
});

test("sendPayload accepts the legacy single-media field with no text", async (t) => {
  const h = setup(t);
  await pingroomChannelPlugin.outbound.sendPayload({ ...h.params, payload: { mediaUrl: h.file("report.txt") } });
  assert.deepEqual(h.calls.broadcasts[0].attachment_ids, ["attachment-1"]);
  assert.equal(h.calls.broadcasts[0].message, "Attachment");
});

test("image attachments preserve their bytes and MIME type", async (t) => {
  const h = setup(t);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGwoAAAAASUVORK5CYII=", "base64");
  await pingroomChannelPlugin.outbound.sendMedia({ ...h.params, mediaUrl: h.file("image.png", png) });
  assert.deepEqual(h.calls.uploads, [{ name: "image.png", type: "image/png", bytes: png }]);
});

test("multiple payload attachments retain their order and are bound only to the first chunk", async (t) => {
  const h = setup(t);
  await pingroomChannelPlugin.outbound.sendPayload({
    ...h.params,
    text: "Report details. ".repeat(15),
    payload: { mediaUrls: [h.file("one.txt", "First"), h.file("two.txt", "Second")] },
  });
  assert.deepEqual(h.calls.uploads.map((file) => file.name), ["one.txt", "two.txt"]);
  assert.equal(h.calls.broadcasts.length, 2);
  assert.deepEqual(h.calls.broadcasts[0].attachment_ids, ["attachment-1", "attachment-2"]);
  assert.equal(h.calls.broadcasts[1].attachment_ids, undefined);
  assert.equal(h.calls.broadcasts[1].requires_ack, undefined);
});

test("media access roots and the host read callback reach the OpenClaw loader", async (t) => {
  const h = setup(t);
  const file = h.file("host.txt", "Disk copy");
  const read = [];
  await pingroomChannelPlugin.outbound.sendMedia({
    ...h.params, mediaLocalRoots: undefined, mediaUrl: "host.txt",
    mediaAccess: {
      localRoots: [h.directory], workspaceDir: h.directory,
      readFile: async (path) => { read.push(path); return Buffer.from("Host-authorized copy"); },
    },
  });
  assert.deepEqual(read, [file]);
  assert.equal(h.calls.uploads[0].bytes.toString(), "Host-authorized copy");
});

test("payload media stays attached to URL-button and Question presentations", async (t) => {
  const h = setup(t);
  const file = h.file("report.txt");
  await pingroomChannelPlugin.outbound.sendPayload({
    ...h.params, payload: { presentation: link, mediaUrls: [file] },
  });
  await pingroomChannelPlugin.outbound.sendPayload({
    ...h.params, payload: { mediaUrl: file, presentation: {
      title: "Approve the report?", blocks: [{ type: "buttons", buttons: [
        { label: "Yes", action: { type: "question", questionId: "ask-1", optionValue: "yes" } },
        { label: "No", action: { type: "question", questionId: "ask-1", optionValue: "no" } },
      ] }],
    } },
  });
  assert.deepEqual(h.calls.broadcasts[0].attachment_ids, ["attachment-1"]);
  assert.deepEqual(h.calls.questions[0].attachment_ids, ["attachment-2"]);
  assert.deepEqual(h.calls.watched, ["question-1"]);
});

test("a Pro rejection fails the media send instead of silently sending just the caption", async (t) => {
  const h = setup(t, { uploadStatus: 402 });
  await assert.rejects(pingroomChannelPlugin.outbound.sendPayload({
    ...h.params, text: "Report", payload: { mediaUrl: h.file("report.txt") },
  }), /Attachments require Pro/);
  assert.equal(h.calls.broadcasts.length, 0);
});

test("attachments outside host-authorized roots are refused before uploading", async (t) => {
  const h = setup(t);
  await assert.rejects(pingroomChannelPlugin.outbound.sendMedia({
    ...h.params, mediaUrl: h.file("private.txt"), mediaLocalRoots: [join(h.directory, "allowed")],
  }), /allowed|root/i);
  assert.equal(h.calls.uploads.length, 0);
});

test("private-network media URLs retain OpenClaw SSRF protection", async (t) => {
  const h = setup(t);
  await assert.rejects(pingroomChannelPlugin.outbound.sendMedia({
    ...h.params, mediaUrl: "http://127.0.0.1/report.txt",
  }), /blocked|private|internal|forbidden/i);
  assert.equal(h.calls.uploads.length, 0);
});

test("oversized media and more than four attachments fail before uploading", async (t) => {
  const h = setup(t);
  await assert.rejects(pingroomChannelPlugin.outbound.sendMedia({
    ...h.params, mediaUrl: h.file("large.txt", Buffer.alloc(5 * 1024 * 1024 + 1, 97)),
  }), /exceeds|limit/i);
  const file = h.file("small.txt");
  await assert.rejects(pingroomChannelPlugin.outbound.sendPayload({
    ...h.params, payload: { mediaUrls: Array(5).fill(file) },
  }), /at most 4/);
  assert.equal(h.calls.uploads.length, 0);
});

test("full-text overflow never makes four media attachments exceed the API cap", async (t) => {
  const h = setup(t, { overflow: "attach" });
  await pingroomChannelPlugin.outbound.sendPayload({
    ...h.params, text: "Long report. ".repeat(50),
    payload: { mediaUrls: [1, 2, 3, 4].map((n) => h.file(`${n}.txt`)) },
  });
  assert.equal(h.calls.uploads.length, 4);
  assert.equal(h.calls.broadcasts[0].attachment_ids.length, 4);
  assert.equal(h.calls.broadcasts.at(-1).data.truncated, true);
});
