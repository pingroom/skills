# PingRoom MCP — complete tool reference

Generated from the live `tools/list` of https://api.pingroom.io/api/agent/mcp
(38 tools). Regenerate by POSTing `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
to that endpoint. Every tool call is `tools/call`; in Claude Code the tools
surface as `mcp__pingroom__<name>` when the server was added directly, or as
`mcp__plugin_pingroom_mcp_pingroom__<name>` when it came from the PingRoom
plugin (load schemas with ToolSearch "select:<the name your session lists>"
before first use).

Annotations: R = read-only, D = destructive, I = idempotent.

## list_rooms  [RI]

List the rooms the authenticated account belongs to.

  (no arguments)

## list_quick_actions  [RI]

List the quick actions configured for a room.

  - `invite_code` (string) **(required)**. Room invite code.

## trigger_quick_action  [–]

Press a room quick action, notifying its members. Rate-limited.

  - `invite_code` (string) **(required)**. Room invite code.
  - `action_number` (integer) **(required)** — 1–4. Quick-action slot number (1–4).
  - `trigger_source` (string) — one of: `manual`, `location`. Defaults to "manual". Only these two are client-settable — "webhook" and "system" are stamped server-side and are rejected here.
  - `is_urgent` (boolean). Deliver this one press time-sensitive so it breaks through Focus / Do Not Disturb. Send-time only — the action's saved configuration is unchanged.
  - `requires_ack` (boolean). Keep this one press open until an eligible recipient acknowledges it. Send-time only and elevating only: true adds the acknowledgement to an action that has none, false never disables the action's stored ack policy.

## broadcast  [–]

Send a custom ping to a room the account belongs to. Rate-limited. Not available in personal rooms (use trigger_quick_action there).

  - `invite_code` (string) **(required)**. Room invite code.
  - `message` (string) **(required)** — ≤160 chars. Ping body text (max 120 characters in private rooms, 160 in public rooms).
  - `title` (string) — ≤40 chars. Optional headline. Defaults to the room name.
  - `action_number` (integer) — 1–4. Optional quick-action slot to attribute the ping to.
  - `action_icon` (string) — ≤50 chars. Optional emoji shown with the ping.
  - `data` (object). Arbitrary structured context (max 25 keys / 8KB). Read surfaces return it after connector privacy filtering; do not put secrets in data. data.location is reserved for a shareable location, and data.url + data.button_label are reserved for a tappable link ping.
    - `data.location` (object). A shareable geographic location.
      - `data.location.latitude` (number). Latitude in decimal degrees.
      - `data.location.longitude` (number). Longitude in decimal degrees.
      - `data.location.label` (string). Optional place name shown to the recipient.
      - `data.location.address` (string). Optional formatted street address.
    - `data.url` (string). Reserved: an absolute http:// or https:// URL. Present turns the ping into a tappable link.
    - `data.button_label` (string). Reserved: label for the link button rendered for data.url.
    - `data.label` (string). Reserved: short caption shown with the link ping.
  - `correlation_id` (string) — ≤255 chars. Your own id, echoed back unchanged on read.
  - `reply_to` (string) — ≤255 chars. Id of the ping this one answers (notification id or correlation id).
  - `is_urgent` (boolean). Deliver time-sensitive so the ping breaks through Focus / Do Not Disturb. Independent of requires_ack: urgent affects delivery only and asks nothing of the recipient.
  - `requires_ack` (boolean). Keep this ping open until one eligible recipient acknowledges it, and show it as a lock-screen card with an Acknowledge button. Does not raise the interruption level on its own — combine with is_urgent for an ack that also breaks through Focus.
  - `ack_timeout_seconds` (integer) — 60–86400. Optional acknowledgement deadline in seconds.
  - `attachment_ids` (array) — ≤4 items. Ids of up to 4 uploaded attachments (see upload_attachment) to include. Uploading requires a Pro account.

## live_status  [I]

Start, update, or end a live progress card on the room members' lock screen (an iOS Live Activity / Android live update). Reuse the same correlation_id for every ping of one stream: the first ping starts the card and sends one alert, further "running" pings move it silently, and the first "done"/"failed" sends one completion alert and ends it. Free accounts get a small number of NEW streams per day; updates and the final ping are never charged.

  - `invite_code` (string) **(required)**. Room invite code.
  - `correlation_id` (string) **(required)** — ≤255 chars. The stream key. Reuse it on every ping of the same stream.
  - `live_status` (object) **(required)**. The live card's state. Only state is required.
    - `live_status.state` (string) **(required)**. running keeps the card live; done/failed end it with one completion alert.
    - `live_status.template` (string). Which layout the OS renders. Fixed at stream creation.
    - `live_status.category` (string). Legacy rendering category; prefer template. "alert" has NO template equivalent and is the only way to start a stream time-sensitive (breaks through Focus). Fixed at stream creation.
    - `live_status.message` (string). The card's live message line.
    - `live_status.progress` (number). Progress bar / Dynamic Island gauge, 0..1.
    - `live_status.steps` (array). Step labels. Required on the first ping of a steps stream; immutable afterwards.
    - `live_status.current_step` (integer). Index into steps; the only mutable steps field.
    - `live_status.metrics` (array). Up to 3 {label,value} counters for the metrics template.
    - `live_status.deadline_at` (integer). Epoch seconds the countdown template counts down to.
    - `live_status.eta_at` (integer). Epoch seconds; renders a live ETA on status/progress.
    - `live_status.prompt` (string). The ask, for the question template.
    - `live_status.options` (array). Up to 4 {value,label} choices for the question template.
    - `live_status.left` (object). Left side {label,value} for the matchup template.
      - `live_status.left.label` (string). 
      - `live_status.left.value` (string). 
    - `live_status.right` (object). Right side {label,value} for the matchup template.
      - `live_status.right.label` (string). 
      - `live_status.right.value` (string). 
    - `live_status.center` (string). Center score/clock for the matchup template.
    - `live_status.accent_override` (string). Hex #rrggbb; a semantic accent for one frame (e.g. deadline red).
  - `title` (string) — ≤40 chars. Card title. Defaults to the selected quick action's label.
  - `action` (integer) — 1–4. Quick-action slot to attribute the stream to (supplies the icon and sound).
  - `data` (object). Arbitrary structured context (max 25 keys / 8KB), returned on read surfaces after connector privacy filtering. Do not put secrets in data.
  - `requires_ack` (boolean). Add an Acknowledge button; the first eligible member to tap resolves it for everyone. Does not raise the interruption level — set category "alert" for a time-sensitive start.
  - `ack_timeout_seconds` (integer) — 1–86400. Optional acknowledgement deadline in seconds.

## get_live_status  [RI]

Read back the current state of a live stream you created, so a restarted producer can reconcile instead of starting a duplicate. Only returns streams started by this credential, within the last 24 hours. Returns notification_id and correlation_id, then the stored display state (state, progress, message, category, template, accent_override, eta_at, deadline_at, metrics, prompt, options, left, right, center, steps, current_step), action_state, and updated_at. Fields you never set come back as null rather than being omitted, so a matchup/metrics/countdown/question stream can be resumed without re-sending content.

  - `invite_code` (string) **(required)**. Room invite code.
  - `correlation_id` (string) **(required)** — ≤255 chars. The stream key used when the stream was started.

## list_room_icons  [RI]

List the room-icon catalog (icon ids, tags, and categories) for interpreting icon values returned by room and quick-action reads.

  (no arguments)

## list_notifications  [RI]

List a bounded page of recent pings across approved rooms, newest first. Use page to continue while has_more is true.

  - `type` (string) — one of: `received`, `sent`. Narrow to pings you received or pings you sent. Omit for both.
  - `date` (string). Only pings created on this calendar date, e.g. "2026-08-25".
  - `limit` (integer) — 1–25. Pings per page. Defaults to 10; maximum 25.
  - `page` (integer) — 1–. Page number, newest first.

## get_notification  [RI]

Fetch one visible ping by notification id, including its current action_state.

  - `notification_id` (string) **(required)**. Room notification id.

## wait_for_notification  [RI]

Long-poll for the next ping. Blocks until one arrives or the timeout elapses — the real-time inbound channel for an agent. The agent's own sends are excluded.

  - `after` (string). Cursor from the previous call; omit to get the current head.
  - `timeout` (integer) — 1–30. Seconds to hold the request open (server-capped).

## wait_for_ack  [RI]

Long-poll a generic acknowledgement-required ping until an eligible recipient acknowledges it, it expires, or the timeout elapses. Questions use wait_for_answer instead.

  - `notification_id` (string) **(required)**. Room notification id.
  - `timeout` (integer) — 0–30. Seconds to hold the request open. Use 0 for an immediate authoritative state read.

## request_approval  [–]

Ask the human to approve or reject an action, then block on their answer (pair with wait_for_approval). Delivered as a push to the user. Rate-limited.

  - `invite_code` (string) **(required)**. Room invite code.
  - `question` (string) **(required)** — ≤500 chars. What you want the human to decide on.
  - `title` (string) — ≤40 chars. Optional short title for the request.
  - `options` (array) — ≤4 items. Answers to choose between. Defaults to ["approve","deny"].
  - `correlation_id` (string) — ≤255 chars. Your own id, echoed back unchanged on read.
  - `data` (object). Arbitrary structured context, returned on reads after connector privacy filtering. Do not put secrets in data.
  - `ttl` (integer) — 1–. Seconds the request stays open before it expires.

## wait_for_approval  [RI]

Long-poll an approval request until the human decides or it expires. Returns the status and, once decided, the chosen option.

  - `approval_id` (string) **(required)**. Approval request id.
  - `timeout` (integer) — 1–30. Seconds to hold the request open (server-capped).

## get_approval  [RI]

Fetch the current status of an approval request without blocking.

  - `approval_id` (string) **(required)**. Approval request id.

## ask_question  [–]

Ask a person a question with 2-4 tappable options, then block on their answer (pair with wait_for_answer). Delivered as a push they can answer from the lock screen or in-app; the first valid answer wins. Rate-limited.

  - `invite_code` (string) **(required)**. Room invite code.
  - `prompt` (string) **(required)** — ≤500 chars. The question the person reads.
  - `context` (string) — ≤40 chars. Optional secondary line, e.g. a build number.
  - `options` (array) — ≤4 items. Answer options in display order. Omit for a default Approve/Deny.
  - `text_input` (object). Invite a typed answer (on its own, or alongside options). max_length is capped at 60.
    - `text_input.placeholder` (string). Hint shown in the reply field.
    - `text_input.max_length` (integer). Max characters (default 60).
  - `correlation_id` (string) — ≤255 chars. Your own id, echoed back unchanged on read.
  - `reply_to` (string) — ≤255 chars. Optional routing pointer, echoed back unchanged.
  - `data` (object). Arbitrary structured context (max 25 keys / 8KB). Read surfaces return it after connector privacy filtering; do not put secrets in data. data.location is reserved for a shareable location.
    - `data.location` (object). A shareable geographic location.
      - `data.location.latitude` (number). Latitude in decimal degrees.
      - `data.location.longitude` (number). Longitude in decimal degrees.
      - `data.location.label` (string). Optional place name shown to the recipient.
      - `data.location.address` (string). Optional formatted street address.
  - `ttl` (integer) — 1–. Seconds the question stays open before it expires.
  - `attachment_ids` (array) — ≤4 items. Ids of up to 4 uploaded attachments (see upload_attachment) to include. Uploading requires a Pro account.

## wait_for_answer  [RI]

Long-poll a question until it is answered or expires. Returns the state and, once answered, the chosen option value + label and the responder.

  - `question_id` (string) **(required)**. Question id.
  - `timeout` (integer) — 1–30. Seconds to hold the request open (server-capped).

## get_question  [RI]

Fetch the current state of a question without blocking.

  - `question_id` (string) **(required)**. Question id.

## list_questions  [RI]

List a bounded page of questions you asked, newest first. Optionally filter by state; use page while has_more is true.

  - `state` (string) — one of: `pending`, `answered`, `expired`, `cancelled`, `all`. Filter by state. Omit for all.
  - `limit` (integer) — 1–25. Questions per page. Defaults to 10; maximum 25.
  - `page` (integer) — 1–. Page number, newest first.

## cancel_question  [DI]

Withdraw a still-pending question you asked.

  - `question_id` (string) **(required)**. Question id.

## activate_agent_inbox  [–]

Start or resume the onboarding Question in the private room the human chose during authorization. Read question.id, then call wait_for_handoff only while state is pending and within a bounded local deadline. Success is answered with activation_completed true. Any other terminal result is incomplete: stop polling that attempt, then call activate_agent_inbox again for one numbered retry. The stamp requires native phone receipt before the human answer.

  (no arguments)

## create_handoff  [–]

Hand work to exactly one human as either an acknowledgement or a tappable question. The server verifies that one of the recipient's current devices supports the complete Handoff action before creating anything.

  - `kind` (string) **(required)** — one of: `ack`, `question`. ack asks the human to acknowledge; question asks them to choose an option.
  - `prompt` (string) **(required)** — ≤500 chars. The work/request shown to the human.
  - `audience` (object) **(required)**. 
    - `audience.type` (string) **(required)**. 
    - `audience.user_id` (string) **(required)**. The authorizing human, expressed as the literal value "me".
  - `expires_in` (integer). Seconds before the handoff expires; the server clamps this to its safe range.
  - `urgency` (string) — one of: `active`, `passive`. Notification interruption level. Defaults to active.
  - `options` (array) — ≤4 items. Required for question and forbidden for ack. Each item may be a label string or a structured option.
  - `data` (object). Structured context returned on read surfaces after connector privacy filtering. Do not put secrets in data.
  - `correlation_id` (string) — ≤255 chars. Your own stable correlation id.
  - `reply_to` (string) — ≤255 chars. Optional routing pointer.
  - `idempotency_key` (string) — ≤255 chars. Stable key for at-most-once creation across both Ack and Question kinds.

## wait_for_handoff  [–]

Long-poll a Handoff until the human resolves it, it expires, or the bounded timeout elapses. For the onboarding Question returned by activate_agent_inbox, success requires an answered result with activation_completed true; use a bounded local deadline and treat any terminal answer without that stamp as incomplete.

  - `handoff_id` (string) **(required)**. Handoff id.
  - `timeout` (integer) — 0–25. Seconds to hold the request open; use 0 for an immediate state read.

## get_handoff  [RI]

Fetch the authoritative current state of one Handoff without blocking.

  - `handoff_id` (string) **(required)**. Handoff id.

## list_handoffs  [RI]

List a bounded page of this agent's Handoffs, newest first. Omit state (or use open) for unresolved work; use all for history and page while has_more is true.

  - `state` (string) — one of: `open`, `all`. Filter to open Handoffs or include all states.
  - `limit` (integer) — 1–25. Handoffs per page. Defaults to 10; maximum 25.
  - `page` (integer) — 1–. Page number, newest first.

## upload_attachment  [–]

Upload a small file (max ~90 KiB over MCP; Pro account required) and get an attachment id to include in broadcast or ask_question via attachment_ids. Larger files: use the PingRoom CLI or agent REST API.

  - `filename` (string) **(required)** — ≤255 chars. File name including extension, e.g. report.md.
  - `content_base64` (string) **(required)** — ≤124000 chars. Base64-encoded file bytes (standard alphabet, padding optional).
  - `mime_type` (string) — ≤100 chars. Optional MIME type, e.g. text/markdown. Defaults from the filename extension.

## get_attachment  [RI]

Fetch an attachment visible to this agent as base64 content plus metadata. Results over the connector size limit return attachment_too_large — fetch those via the agent REST API instead.

  - `attachment_id` (string) **(required)**. Attachment id returned by upload_attachment.

## delete_attachment  [DI]

Delete an attachment this agent uploaded that is not yet claimed by a ping.

  - `attachment_id` (string) **(required)**. Attachment id returned by upload_attachment.

## get_room  [RI]

Fetch a single room by its invite code, including members and quick actions.

  - `invite_code` (string) **(required)**. Room invite code.

## create_room  [–]

Create a new room owned by the authenticated account. Free accounts may own up to five rooms.

  - `name` (string) **(required)** — ≤24 chars. Room display name.
  - `icon` (string) **(required)**. Emoji or icon id.
  - `color` (string) **(required)**. Hex color, e.g. "#e33122".

## create_public_room  [–]

Create a publicly discoverable room with a unique @handle. Counts toward the free-plan five-room cap.

  - `name` (string) **(required)** — ≤24 chars. Room display name.
  - `icon` (string) **(required)**. Emoji or icon id.
  - `color` (string) **(required)**. Hex color, e.g. "#e33122".
  - `handle` (string) **(required)**. Globally unique @handle (vanity URL): lowercase letters, digits, underscores.
  - `description` (string) — ≤120 chars. Short room description shown in public discovery.
  - `category` (string) — ≤100 chars. Discovery category.
  - `show_owner` (boolean). Whether the owner is shown publicly. Defaults to true.

## join_room  [DI]

Join a room using its invite code. Include the password only if the room is protected.

  - `invite_code` (string) **(required)**. Room invite code.
  - `password` (string). Only required for password-protected rooms.

## list_webhooks  [RI]

List the incoming webhooks (with their trigger URLs) for a room the account owns.

  - `invite_code` (string) **(required)**. Room invite code.

## create_webhook  [–]

Create an incoming webhook for a room the account owns. The bound account must be Pro. Returns the secret trigger URL — treat it as a credential.

  - `invite_code` (string) **(required)**. Room invite code.
  - `name` (string) **(required)** — ≤100 chars. Webhook name (shown to the owner).
  - `title` (string) — ≤40 chars. Optional push title used when the webhook fires.
  - `message` (string) — ≤160 chars. Optional default push body (max 120 characters in private rooms, 160 in public rooms).
  - `icon` (string). A v3 room-icon catalog id, e.g. "bell". Call list_room_icons to discover the valid ids.
  - `color` (string). Hex color, e.g. "#e33122".
  - `sound` (string). Canonical sound id, e.g. "ting". Omit for the room default.
  - `action_number` (integer) — 1–4. Quick-action slot to attribute fires to. Auto-assigned if omitted.
  - `enabled` (boolean). Whether the webhook is active. Defaults to true.
  - `cooldown_seconds` (integer) — 0–60. Minimum seconds between fires. Defaults to 5.

## update_webhook  [D]

Update an incoming webhook (by id) on a room the account owns — e.g. change its icon, title, message, or sound.

  - `invite_code` (string) **(required)**. Room invite code.
  - `webhook_id` (string) **(required)**. Webhook id (from list_webhooks or create_webhook).
  - `name` (string) — ≤100 chars. Webhook name (shown to the owner).
  - `title` (string) — ≤40 chars. Push title used when the webhook fires.
  - `message` (string) — ≤160 chars. Default push body (max 120 characters in private rooms, 160 in public rooms).
  - `icon` (string). A v3 room-icon catalog id, e.g. "bell". Call list_room_icons to discover the valid ids.
  - `color` (string). Hex color, e.g. "#e33122".
  - `sound` (string). Canonical sound id, e.g. "ting".
  - `action_number` (integer) — 1–4. Quick-action slot to attribute fires to.
  - `enabled` (boolean). Whether the webhook is active.
  - `cooldown_seconds` (integer) — 0–60. Minimum seconds between fires.
  - `regenerate_secret` (boolean). Rotate the secret trigger URL.

## delete_webhook  [DI]

Delete an incoming webhook (by id) from a room the account owns.

  - `invite_code` (string) **(required)**. Room invite code.
  - `webhook_id` (string) **(required)**. Webhook id (from list_webhooks or create_webhook).

## update_quick_action  [DI]

Configure a numbered quick-action slot for a room the account owns.

  - `invite_code` (string) **(required)**. Room invite code.
  - `action_number` (integer) **(required)** — 1–4. Quick-action slot number (1–4).
  - `label` (string) **(required)** — ≤255 chars. Button label. Must be sent, but may be empty (`""`) — a Ping can be named by its emoji alone, and clients render an untitled one as just the emoji.
  - `icon` (string) **(required)**. Emoji or icon id.
  - `sound` (string). Canonical sound id, e.g. "ting". Omit for the room default.
  - `requires_ack` (boolean). Whether pings from this action remain open until one eligible recipient acknowledges them.

## set_avatar  [DI]

Set this agent's avatar. Must be one of the PingRoom bot avatars.

  - `avatar_id` (string) **(required)**. Bot avatar id, e.g. "bots-3".

## rotate_handle  [D]

Rotate this agent's public handle — kill-switch for a leaked handle.

  (no arguments)
