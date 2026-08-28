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
  rooms, webhooks, or quick actions via the CLI.
---

# PingRoom: reach a human, get a real answer

PingRoom turns "the agent finished / needs input" into an event on a person's
phone: a push they feel, a card on their lock screen, a question they answer
with one tap. You reach it over MCP (`mcp__pingroom__*` tools); a paired
`pingroom` CLI may also be available for what MCP doesn't carry.

Read `references/tools.md` for the full 27-tool schema reference when you need
exact parameters. This file teaches you which tool to reach for and the rules
that make the difference between "sent" and "landed".

## The one rule that matters

**A successful send proves PingRoom accepted delivery work — not that a person
received, saw, or acted.** Never report "I notified them" as "they know".
When the task needs a human to actually respond, use a primitive that closes
the loop, then block on its wait tool:

| You need | Send with | Block with | Resolved states |
|---|---|---|---|
| Someone to see + confirm | `broadcast` with `requires_ack: true` | `wait_for_ack` | acked / expired |
| A choice among 2–4 options | `ask_question` | `wait_for_answer` | answered / expired / cancelled |
| Permission before acting | `request_approval` | `wait_for_approval` | approved / denied / expired |
| Your authorizing human, privately | `create_handoff` | `wait_for_handoff` | acked or answered / expired |

Pending, timeout, enqueued, and delivery states are **not** answers. If a wait
expires, say so plainly and do not proceed as if consent was given.

## Picking a room

Call `list_rooms` first (cache the result for the conversation). Rules:

- Personal rooms (`type: "personal"`) refuse `broadcast` — use
  `trigger_quick_action` there.
- Public rooms allow 160-char messages; private rooms 120. Titles cap at 40.
- Sends into single-member rooms are refused (`validation_failed`) — a ping
  needs a recipient other than the sender.
- If the user names a room ambiguously, match on name case-insensitively; when
  several match, ask which one rather than guessing.

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
Delete an unclaimed upload with `delete_attachment`. If `upload_attachment`
fails with a scope error, the connector's grant predates attachments — fall
back to the CLI, and mention that reconnecting the MCP connector with the
`pingroom:attachments:write` scope would enable the direct path.

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
`request_approval { invite_code, prompt, context?, ttl? }` is the deploy-gate
primitive: a dedicated approve/deny card. Block with `wait_for_approval` and
branch on `approved` / `denied` / `expired` — treat `expired` as "no", never
as "probably fine".

### Handoffs (your authorizing human, privately)
`create_handoff { kind: "ack"|"question", prompt, audience: { type: "user",
user_id: "me" }, options? (question only), urgency?, expires_in? }` reaches
the one human who authorized this agent — a private loop no room member sees.
Use it when the decision belongs to *your* human specifically, not to a room.
Block with `wait_for_handoff`. If creation fails with recipient-not-ready, the
human's device hasn't enabled the Handoff surface — `activate_agent_inbox`
sends them a one-tap activation, then retry.

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
- `list_notifications { invite_code?, limit?, page? }` /
  `get_notification { notification_id }` — history, including `data`,
  `correlation_id`, attachments, and ack state.
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
| `insufficient_scope` / `invalid_credential` | The token predates the permission or has the wrong audience. Reconnect the connector (or use the CLI, which holds its own credential). |
| `attachment_too_large` | Over the MCP result cap — use `pingroom attachment get <id> --out …`. |
| `validation_failed` | Read the message; commonly a single-member room or a length cap. |
| `quota_exceeded` / HTTP 429 | Back off; respect Retry-After. Never hot-loop a wait tool — they long-poll server-side already. |

A tool being listed does not mean this token may call it: `tools/list` is a
static catalog and each call re-checks its OAuth scope.

## CLI companion

The `pingroom` CLI shares the account and adds what MCP doesn't carry — large
attachments, room/webhook/quick-action management, CI and hook integration.
When the work is a script, CI job, or a file over ~90 KiB, switch to the
`pingroom-cli` skill (sibling of this one) instead of forcing it through MCP.

## Tone of what you send

Pings land on lock screens. Write them like events: present tense, concrete,
no fluff ("Deploy finished — 3 services green", not "I have completed the
deployment process"). One ping per event; a thread of five pings is worse than
one ping with an attachment. When you finish a piece of work the human asked
to be told about, one well-formed ping *is* the deliverable — send it without
being reminded.
