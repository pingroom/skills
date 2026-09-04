# @pingroom/openclaw-plugin

PingRoom as an [OpenClaw](https://docs.openclaw.ai) **channel**: your agent
reaches you with a real push, a card on your lock screen, and a question you
answer with one tap.

OpenClaw's other channels are chat surfaces. This one is a notification
surface — pings carry urgency, `ask_user` questions become tappable
lock-screen Questions, and exec approvals become approve/deny cards.

- **Guide:** https://pingroom.io/connect-openclaw.md
- **Requires:** OpenClaw ≥ 2026.8.2, Node ≥ 22.22.3, PingRoom SDK ≥ 0.4.6

## Install

```bash
openclaw plugins install npm:@pingroom/openclaw-plugin@0.1.2
openclaw plugins enable pingroom
```

Before connecting, install or open PingRoom on your phone and sign in:
<https://pingroom.io/i>. The app receives urgent Pings, questions, approvals,
handoffs, and live progress. Installing it does not claim the robot or grant it
access.

Then, in any chat with your agent:

```
/pingroom connect
```

Open the claim link or scan its QR. PingRoom has already created a separate
OpenClaw robot profile, with its own `@handle` and robot avatar when the server
supports identity previews. Sign in, claim that robot, and choose which rooms
it can reach. It acts for you without becoming your personal PingRoom profile.
The plugin saves the credential, reusable latest-pings URL, and token-free
app-install URL under `channels.pingroom`. The latest-pings URL contains no
credential; requests to it use the saved bearer token.

WebChat shows the short-lived pairing QR without saving it to chat history.
Channels that support images receive the QR as an attachment. The claim link
remains available if the QR cannot be scanned. If you leave the claim screen to
install the app, return to that exact link before it expires. While pairing is
pending, `/pingroom connect` returns the same robot and claim link.

All `/pingroom` connection-management actions are owner-only. `/pingroom
status` shows the saved feed URL, and `/pingroom rooms` lists the rooms the
robot may reach. Reconnecting saves the replacement before revoking the
previous plugin-owned credential. `/pingroom disconnect` revokes plugin-owned
credentials; shared env, SecretRef, and CLI credentials are disabled locally
without breaking their other consumers. The command is `connect`, never `pair`:
OpenClaw's own `/pair` is DM allowlist pairing and means something else.

## What it does

| The agent does | Your phone gets |
|---|---|
| Sends a final reply | A ping (≤120 chars, chunked) |
| Sends a supported `ask_user` presentation | A Question card with 2–4 tappable options |
| Sends an exec/plugin approval presentation | An approve / deny card |
| Emits a link | A ping with a tappable button |
| Sends a supported image or file | A ping with an attachment, even without a caption |
| An allowed room member pings | A message in the agent's session |

Answers use OpenClaw's public channel resolution adapters and the Gateway's
authorization checks. Only the paired human's verified answer can
resolve a Question or approval. Typed answers return to the original session
when the host supplied it with the outgoing payload. Expiry and cancellation
do not count as approval; the Gateway handles those terminal states.

The gateway service starts long-polling and resumes handling pending Questions
on startup. Question metadata is signed for this gateway and credential, so
another installation or a modified session id cannot resume a local task.
Keep the gateway state directory when upgrading. Questions created by older
plugin versions have no such binding; answer those in the original OpenClaw
chat, or ask a fresh Question after upgrading.

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
      links: {
        latest_pings: "https://api.pingroom.io/api/agent/notifications?limit=25&page=1",
        install_app: "https://pingroom.io/i",
      },
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

**Attachments (Pro).** Replies support up to four files, each at most 5 MiB:
PNG, JPEG, PDF, Markdown, HTML, plain text, and ZIP. Media uses OpenClaw's
allowed file roots and remote URL checks. If a supplied attachment cannot be
read or uploaded, the send fails with an error. Link and attachment pings
honor the same urgency, acknowledgment, and reply settings as text pings.

**`dmPolicy: "pairing"` is rejected.** OpenClaw's pairing DMs a code to an
unknown sender; PingRoom cannot DM a non-member, and putting a code in a shared
room shows it to everyone. Use `allowlist`.

An empty `allowFrom` list blocks ordinary incoming room pings. Add the
PingRoom user ids allowed to talk to the agent, or explicitly choose `open`.
Questions still accept the paired human's answer. The poll feed excludes the
bound human's own ordinary sends and machine-generated traffic.

**Webhooks (optional, Pro).** With `webhook.enabled` the plugin registers a
gateway route at `/pingroom/events` (override with `webhook.path`). Set
`webhook.secret` to the outgoing webhook's signing secret and configure that
webhook in PingRoom to deliver to the gateway URL. The route verifies HMAC-v2
(or legacy HMAC-v1), then reads the authoritative record before dispatching.
Polling keeps running either way. The gateway must be reachable by PingRoom.

## Running the CLI from the agent

The plugin bundles the `pingroom` skill and contributes `PINGROOM_HOME` to
`exec`, so an agent can shell out to the CLI without a token in its
environment. Set `execEnv.injectToken` only if your agent runs sandboxed and
cannot read the gateway's filesystem — hook-contributed env appears in Gateway
approval and audit metadata.
The credential file belongs to the plugin's gateway state directory, has mode
0600, and is removed when the service stops. Install CLI 0.10.1 or later
separately to use the bundled skill's commands.

If a private handoff or activation reports `recipient_not_ready`, keep the
connection and show the server's explanation. Ask the person to install or update
PingRoom at <https://pingroom.io/i>, open it, sign in, and enable notifications.
Then run `/pingroom activate` in chat. It runs the activation ceremony with
this plugin's own credential, so it works whether or not the CLI is installed.
Do not retry the original action until the test Question is answered and
activation reports success; installation alone does not show that the phone is
ready.

## Development

```bash
npm install
npm test                                    # builds, then runs the suite
openclaw plugins install --link . --force
openclaw plugins inspect pingroom --runtime --json
```

This source tree contains version 0.1.2; npm still serves 0.1.0. Publish SDK
0.4.6 before publishing this package; publish CLI 0.10.1 before directing users to
the bundled CLI skill. After SDK publication, run `npm install --package-lock-only`
to record the published tarball integrity, then `npm run prepublishOnly`. The
package includes `/pingroom activate`; older plugin 0.1.0 does not.
