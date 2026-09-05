---
name: pingroom-mcp
description: >-
  Reach a human through PingRoom — the event platform whose MCP connector this
  session has. Use this skill whenever the task involves notifying, alerting, or
  pinging a person; sending them a file, report, markdown, zip, image, or
  location; sharing a tappable link to their phone; asking a human a question
  and blocking on the answer; requesting an approve/deny decision before acting;
  handing a decision off to your authorizing human; or showing live progress on
  their lock screen while long work runs. Trigger it even when the user doesn't
  say "PingRoom" — phrases like "let me know when it's done", "send this to my
  phone", "ask me before deploying", "ping the team", "notify me", "send me the
  report", or "show progress on my lock screen" all mean this skill. Also use it
  when writing scripts or CI that must alert a person, and for managing PingRoom
  rooms, webhooks, quick actions, the connected agent profile, or redeeming a
  PingRoom gift or promotional code.
---

# PingRoom: reach a human, get a real answer

PingRoom turns "the agent finished / needs input" into an event on a person's
phone: a push they feel, a card on their lock screen, a question they answer
with one tap. You reach it over MCP; a paired `pingroom` CLI may also be
available for what MCP doesn't carry.

Tool names depend on how the server was added. A server added directly is
`mcp__pingroom__<name>`; one installed as part of the PingRoom plugin is
`mcp__plugin_pingroom_mcp_pingroom__<name>`. Match whichever your session
lists — this file names tools bare (`ask_question`, not the prefixed form).

Read `references/tools.md` for the full 41-tool schema reference when you need
exact parameters. This file teaches you which tool to reach for and the rules
that make the difference between "sent" and "landed".

## Before authorization: get the phone ready

If the human does not have PingRoom, send <https://pingroom.io/i> and explain
that the app receives urgent Pings, questions, approvals, handoffs, and live
progress on their phone. Ask them to install or open it and sign in before
starting OAuth when possible.

Installation is not consent. The human must still complete authorization,
claim the separate MCP robot, and choose which rooms it may reach. If OAuth is
already waiting in the browser, have them return to that same flow after
installation instead of starting another connection.

## Keep the connection receipt

Call `connection_info` once after OAuth completes and retain
`links.latest_pings` and `links.install_app`. The first is a stable GET URL for
the newest pings visible across the granted rooms; the second is the token-free
mobile handoff, and must never receive a credential. `links.latest_pings`
contains no credential, so send the connection's saved bearer token in the
`Authorization` header when fetching it.

## The one rule that matters

**A successful send proves PingRoom accepted delivery work — not that a person
received, saw, or acted.** Never report "I notified them" as "they know".
When the task needs a human to actually respond, use a primitive that closes
the loop, then block on its wait tool:

| You need | Send with | Block with | Resolved states |
|---|---|---|---|
| Someone to see + confirm | `broadcast` with `requires_ack: true` | `wait_for_ack` | acked / expired |
| A choice among 2–4 options | `ask_question` | `wait_for_answer` | answered / expired / cancelled |
| Permission before acting | `ask_question` (2 options) | `wait_for_answer` | answered / expired / cancelled |
| Your authorizing human, privately | `create_handoff` | `wait_for_handoff` | acked or answered / expired |

Pending, timeout, enqueued, and delivery states are **not** answers. If a wait
expires, say so plainly and do not proceed as if consent was given.

**A wait tool holds for at most ~30 seconds and then returns `pending`.** That
is the contract, not a failure: call it again. Loop until you see a terminal
state or you hit a deadline you set yourself, and pass an `idempotency_key` on
the create so a retried call cannot put a second card on someone's phone.

**PingRoom blocks an agent that is still running; it cannot revive one that has
stopped.** If your task ends while a question is open, the human's answer is
still recorded and readable later with `get_question` — but nothing wakes you
to act on it. So only open a gate you intend to stay alive for, and say plainly
that you stopped waiting rather than implying the decision was made.

## Redeem a gift or promotional code

When the human asks to redeem their code, call `redeem_code { code }` with its
12 letters or digits. This applies Pro to the human who authorized the current
connection; no room or existing Pro plan is needed. Surrounding whitespace and
letter case are normalized. Keep the code out of room messages and logs.

Report the returned Pro expiry or lifetime status. Invalid, expired, or used
codes fail; do not retry a rejected code in a loop. The tool needs
`pingroom:codes:redeem`, included in `pingroom:full`. If an older credential
reports `insufficient_scope`, reconnect it to authorize redemption.

## Picking a room

Call `list_rooms` first (cache the result for the conversation). Rules:

- Personal rooms (`type: "personal"`) refuse `broadcast` — use
  `trigger_quick_action` there.
- Public rooms allow 160-char messages; private rooms 120. Titles cap at 40.
- A standard private room with one member self-delivers manual sends, which is
  useful for setup and agent-owned rooms. A one-member public room still
  refuses sends because its fan-out has no targeted fallback.
- If the user names a room ambiguously, match on name case-insensitively; when
  several match, ask which one rather than guessing.

## Creating a room

`create_room { name, icon, color }` (private) or `create_public_room { name,
icon, color, handle }`. Two rules the schema alone won't teach you:

- `icon` is a **v3 catalog id, never an emoji**. Call `list_room_icons` and
  pick an id whose tags fit the room (`bell`, `globe`, `terminal`,
  `paperplane`, …). The server 422s anything off-catalog. Emoji is fine for
  *quick actions*; rooms take catalog ids only.
- `color` is any `#rrggbb` hex — brand colors welcome (e.g. `#e33122`).

Free accounts own at most five rooms (`402 room_limit_reached`).

## Recipes

### Plain ping
`broadcast { invite_code, message, title?, action_icon? }`. Keep the message an
event, not prose: *what happened, what to do, is it done*. Set a `title` only
when the room name alone wouldn't orient the reader.

### Urgent / must-be-confirmed
- `is_urgent: true` breaks through Focus/Do Not Disturb. Delivery-only — it
  asks nothing of the recipient. Reserve it for genuinely time-sensitive events
  or it trains people to ignore it.
- `requires_ack: true` keeps the ping open with a lock-screen Acknowledge
  button until one eligible recipient confirms. Add `ack_timeout_seconds`
  (60–86400) when the confirmation is only useful for a while, then
  `wait_for_ack { notification_id }`.
- The two compose: urgent+ack is "wake them and hold the door".

### Location ping
Put a location in `data.location` — the app renders a tappable map:

```json
{ "invite_code": "…", "message": "Meet here at 6",
  "data": { "location": { "latitude": 48.8584, "longitude": 2.2945,
            "label": "Eiffel Tower", "address": "Champ de Mars, Paris" } } }
```

`latitude`/`longitude` are required inside `location`; `label` and `address`
are what the human actually reads, so include at least `label`.

### Link ping
`data.url` (absolute http/https) turns the ping into a tappable link;
`data.button_label` (≤26 chars) names the button, `data.label` (≤26) adds a
caption. Use for dashboards, PRs, docs — anything better opened than read in
120 chars.

### Structured data + threading
`data` carries up to 25 keys / 8 KB of machine-readable context on every send
primitive — build numbers, commit SHAs, error codes. Never put secrets in it.
Set `correlation_id` (your own stable id) so you can find the ping again on
read surfaces, and `reply_to` (a notification id or correlation id) to thread
a ping as the answer to an earlier one.

### Files and documents (md / txt / html / zip / images — anything)

Two paths; pick by size:

1. **MCP, files ≤ ~90 KiB** (reports, markdown, logs, small HTML):
   `upload_attachment { filename, content_base64, mime_type? }` → returns an
   attachment id → pass `attachment_ids: ["…"]` (max 4) on `broadcast` or
   `ask_question`. Base64 a file with `base64 < file | tr -d '\n'`. The MCP
   request envelope caps at 128 KiB, which is why big files don't fit here.
2. **CLI, anything up to 5 MiB** (zips, images, PDFs):
   `pingroom ping --room <code> -m "…" --attach <path>` — repeat `--attach`
   for up to 4 files. The CLI is paired to the same account
   (`~/.pingroom/credentials.json`).

Both require the account to be Pro (`pro_required` otherwise). Retrieve any
attachment later with `get_attachment { attachment_id }` (base64 back, small
files) or `pingroom attachment get <id> --out <path>` (any size, binary-safe).
Delete an unclaimed upload with `delete_attachment`. If a legacy connector
reports `insufficient_scope`, reconnect it once to replace its partial grant
with full PingRoom access.

### Questions
`ask_question { invite_code, prompt (≤500), options?, text_input?, context?, ttl? }`:

- Omit `options` for a default Approve/Deny; otherwise give 2–4 options in
  display order. Keep labels short — they're lock-screen buttons.
- `text_input: { placeholder, max_length ≤60 }` invites a short typed answer,
  alone or alongside options.
- `context` (≤40) is the secondary line — a build number, a filename.
- Then `wait_for_answer { question_id }`. First valid answer wins. Use
  `cancel_question` if the question became moot; leaving stale questions on
  someone's lock screen erodes trust.
- Re-sending on retry? Pass `idempotency_key` so a network blip can't create
  two questions.

### Approvals
`request_approval { invite_code, question (≤500), title? (≤40), options?,
correlation_id?, data?, ttl?, idempotency_key? }` — note `question`/`title`,
NOT the `prompt`/`context` that questions use.

Block with `wait_for_approval`, then read TWO fields: `status` is
`pending | decided | expired | cancelled`, and the human's choice is in a
separate `decision` (`approve` / `deny` by default). There is no `approved` or
`denied` status — a `decided` status with `decision: "deny"` is a refusal, and
treating "the human answered" as success is how a gate fails open. Treat
`expired` as "no", never as "probably fine".

**Prefer `ask_question` for deploy gates.** An approval is delivered as an
ordinary ping with no answer actions, so the human has to open the app to
decide it; a two-option question (`approve`/`deny`) reaches the lock screen
with real buttons and is answerable in one tap. Reach for `request_approval`
only when you specifically need the legacy approvals surface.

### Handoffs (your authorizing human, privately)
`create_handoff { kind: "ack"|"question", prompt, audience: { type: "direct",
user_id: "me" }, options? (question only), urgency?, expires_in? }` reaches
the one human who authorized this agent — a private loop no room member sees.
Use it when the decision belongs to *your* human specifically, not to a room.
Block with `wait_for_handoff`. If creation fails with recipient-not-ready, the
phone is not ready for the Handoff surface. Keep the connection and show the
server's explanation and install link. Have the human install or update
PingRoom, open it, sign in, and enable notifications. Then call
`activate_agent_inbox`; do not retry the handoff until the person answers its
test Question and the result reports `activation_completed: true`.

### Live progress on the lock screen
For work longer than ~30 seconds, run a live card instead of spamming pings:

1. First `live_status` call with a **new** `correlation_id` starts the stream
   (one alert). Choose the shape up front — `steps` (labels are immutable after
   the first ping), `progress` 0..1, `metrics`, `deadline_at`, or a matchup —
   the template is fixed at creation.
2. Further calls with the **same** `correlation_id` and `state: "running"`
   update the card silently (`current_step`, `progress`, `message`, `eta_at`).
3. End with `state: "done"` or `"failed"` — one completion alert. **Always end
   the stream**, even on error paths; an orphaned card squats on the lock
   screen. One stream per correlation_id, ever — a finished id cannot restart.
4. Free accounts get a daily budget of *new* streams; updates and the final
   ping are free. Don't burn streams on trivial work.
5. **Only the room owner can publish a live stream to a room.** In a room the
   account doesn't own, `live_status` returns `forbidden` — don't retry and
   don't improvise a burst of regular pings as a substitute (that's noise
   nobody asked for). Pick a room the account owns, or tell the user the
   constraint and send ONE ordinary ping when the work finishes.

`get_live_status { invite_code, correlation_id }` reads the current frame.

### Quick actions
`list_quick_actions` shows a room's 4 configured buttons;
`trigger_quick_action { invite_code, action_number }` presses one — this is
also the only send that works in personal rooms. `is_urgent`/`requires_ack`
elevate a single press without changing the saved configuration.

### Reading the room
- `connection_info` — recover the stable latest-pings URL for this connection.
- `list_notifications { type?, date?, limit?, page? }` /
  `get_notification { notification_id }` — history, including `data`,
  `correlation_id`, attachments, and ack state. It spans every approved room;
  there is no `invite_code` filter, and sending one is rejected outright
  (`arguments.invite_code is not an advertised argument`). `type` narrows to
  `received` or `sent`; `date` to one calendar day.
- `wait_for_notification { after? }` — long-poll for *new* pings. Without
  `after` it returns no history, just the current head cursor: call once to
  get the cursor, then poll with it. Your own sends are excluded.

## Error handling

Tool failures come back as `isError: true` with a JSON `{code, message}`. Act
on the code, don't retry blindly:

| code | Meaning → what to do |
|---|---|
| `pro_required` | Attachments/webhooks need Pro. Say so; don't loop. |
| `room_not_granted` | Room is outside this agent's grant. Ask the human to add it under Connected Agents, or pick a granted room. |
| `insufficient_scope` / `invalid_credential` | The token uses a legacy partial grant or the wrong audience. Reconnect once for full access, or use the CLI with its separate credential. |
| `recipient_not_ready` | Keep the connection. Share the returned `install_url`, then have the human install or update PingRoom, open it, sign in, and enable notifications. Call `activate_agent_inbox` again, then wait for the person to answer its test Question and for `activation_completed: true`; installation alone does not prove the phone is ready. |
| `attachment_too_large` | Over the MCP result cap — use `pingroom attachment get <id> --out …`. |
| `validation_failed` | Read the message; commonly a public room with no other member, an unsupported room type, or a length cap. |
| `quota_exceeded` / HTTP 429 | Back off; respect Retry-After. Never hot-loop a wait tool — they long-poll server-side already. |

New MCP connections receive the single `pingroom:full` consent grant. It
expands to 17 internal permissions, including permission to edit the robot's
profile; it does not change the human's account profile. Room grants and
account-tier limits still apply to every call.

## CLI companion

The `pingroom` CLI uses its own paired credential and adds large attachments,
CI, and hook integration. Room, webhook, quick-action, and agent-profile
management are also available through public MCP.
When the work is a script, CI job, or a file over ~90 KiB, switch to the
`pingroom-cli` skill (sibling of this one) instead of forcing it through MCP.

## Tone of what you send

Pings land on lock screens. Write them like events: present tense, concrete,
no fluff ("Deploy finished — 3 services green", not "I have completed the
deployment process"). One ping per event; a thread of five pings is worse than
one ping with an attachment. When you finish a piece of work the human asked
to be told about, one well-formed ping *is* the deliverable — send it without
being reminded.
