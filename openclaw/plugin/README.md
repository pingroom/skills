# @pingroom/openclaw-plugin

PingRoom as an [OpenClaw](https://docs.openclaw.ai) **channel**: your agent
reaches you with a real push, a card on your lock screen, and a question you
answer with one tap.

OpenClaw's other channels are chat surfaces. This one is a notification
surface — pings carry urgency, `ask_user` questions become tappable
lock-screen Questions, and exec approvals become approve/deny cards.

- **Guide:** https://pingroom.io/connect-openclaw.md
- **Requires:** OpenClaw ≥ 2026.8.2, Node ≥ 22.22.3

## Install

```bash
openclaw plugins install npm:@pingroom/openclaw-plugin
openclaw plugins enable pingroom
```

Then, in any chat with your agent:

```
/pingroom connect
```

Approve the link on your phone and pick which rooms the agent may reach. That
is the whole setup — the credential is written into `channels.pingroom` for you.
WebChat displays a QR for the short-lived pairing link without saving it to chat
history. Channels that support images receive the QR as an attachment. The
approval link remains available as a fallback.

`/pingroom status`, `/pingroom rooms`, and `/pingroom disconnect` do what they
say. The command is `connect`, never `pair`: OpenClaw's own `/pair` is DM
allowlist pairing and means something else.

## What it does

| The agent does | Your phone gets |
|---|---|
| Sends a final reply | A ping (≤120 chars, chunked) |
| Calls `ask_user` | A Question card with 2–4 tappable options |
| Requests an exec approval | An approve / deny card |
| Emits a link | A ping with a tappable button |
| Someone pings the room | A message in the agent's session |

Answers come back through the Gateway, so the agent continues where it paused.

## Configuration

Everything lives under `channels.pingroom`:

```json5
{
  channels: {
    pingroom: {
      enabled: true,
      // Written by /pingroom connect; a SecretRef works too:
      // token: { source: "env", provider: "default", id: "PINGROOM_TOKEN" }
      token: "…",
      defaultRoom: "ab12cd",     // where "me" goes
      urgency: "normal",          // "urgent" pierces Focus
      visibleReplies: "final",    // "all" also pings tool/block output
      maxChunksPerReply: 2,       // each chunk is a separate push AND quota unit
      overflow: "truncate",       // "attach" uploads the full reply (Pro)
      questionTtlSeconds: 900,    // matches the ask_user default
      dmPolicy: "allowlist",      // who in a room may talk to the agent
      allowFrom: [],              // PingRoom user ids
      inbound: { enabled: true, pollTimeoutSeconds: 25 },
    },
  },
}
```

**Quota.** Free PingRoom accounts get 20 agent operations per day. The defaults
are chosen for that: only the final reply becomes a ping, at most two chunks.
Raise `maxChunksPerReply` or set `visibleReplies: "all"` only if the account is
Pro or you like running out.

**`dmPolicy: "pairing"` is rejected.** OpenClaw's pairing DMs a code to an
unknown sender; PingRoom cannot DM a non-member, and putting a code in a shared
room shows it to everyone. Use `allowlist`.

**Webhooks (optional, Pro).** With `webhook.enabled` the plugin registers a
gateway route and verifies PingRoom's HMAC-v2 signature, so answers arrive
immediately instead of on the next poll. Polling keeps running either way.

## Running the CLI from the agent

The plugin bundles the `pingroom` skill and contributes `PINGROOM_HOME` to
`exec`, so an agent can shell out to the CLI without a token in its
environment. Set `execEnv.injectToken` only if your agent runs sandboxed and
cannot read the gateway's filesystem — hook-contributed env appears in Gateway
approval and audit metadata.

## Development

```bash
npm install
npm test                                    # builds, then runs the suite
openclaw plugins install --link . --force
openclaw plugins inspect pingroom --runtime --json
```
