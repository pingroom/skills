import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createClient } from "../dist/client.js";

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

for (const status of [307, 308]) {
  test(`the account client refuses HTTP ${status} credential-body forwarding`, async (t) => {
    let forwardedRequests = 0;
    const target = await serve(t, (req, res) => {
      forwardedRequests += 1;
      req.resume();
      res.end('{"credential":"replacement"}');
    });
    const baseUrl = await serve(t, (req, res) => {
      req.resume();
      res.writeHead(status, { Location: `${target}/collect` });
      res.end();
    });
    const client = createClient({ baseUrl, token: "fixture-token" });
    await assert.rejects(client.auth.claimComplete({ email: "fixture@example.test", otp: "123456" }), {
      code: "network_error",
    });
    assert.equal(forwardedRequests, 0);
  });
}
