---
name: pingroom-cli
description: >-
  Use the `pingroom` CLI to reach humans from terminals, scripts, CI, and
  Claude Code hooks — send pings with file attachments up to 5 MiB (zip, pdf,
  images, markdown, html, txt), tappable links, map locations, and
  acknowledgement requests; ask questions and block a shell on the human's
  answer; gate deploys on approve/deny; drive lock-screen live-progress cards;
  stream incoming pings; and manage rooms, webhooks, and quick actions. Reach
  for this skill whenever work happens in a shell — a CI pipeline that must
  alert someone, a script that needs sign-off, "ping me from the build",
  attaching a large file to a PingRoom message, wiring Claude Code hooks to a
  phone, or creating/configuring PingRoom rooms and webhooks. If the task is
  conversational (no shell), prefer the sibling `pingroom-mcp` skill.
  Also use it to redeem a PingRoom gift or promotional code.
---

# pingroom CLI: humans in the loop, from a shell

`pingroom` is a Node ≥ 20 CLI (`npm i -g @pingroom/cli`) that turns shell
steps into events on a person's phone — and turns human decisions into exit
codes a script can branch on. A paired credential lives in
`~/.pingroom/credentials.json`; run bare `pingroom` once in an interactive
terminal to pair, `pingroom pair` where there is no terminal, or set
`PINGROOM_TOKEN` in CI.

## Auth model — pick the mode before the flags

- **Agent token mode** (default here): the stored credential, or
  `--token` / `PINGROOM_TOKEN`, plus `--room <code>` (or
  `pingroom config set default_room <code>`). Full feature set.
- **Webhook mode**: `pingroom ping -w <webhook-url>` — the URL carries its own
  secret, no account needed. Best for CI that should only ever ping one room.
  Only `ping` supports it. From CLI 0.14.0 an exported `PINGROOM_WEBHOOK_URL`
  is only the fallback: an explicit `--token` or `--room` takes the
  agent-token path, and `-w` together with `--token`/`--room` exits 2.
- Not connected? Bare `pingroom` in an interactive terminal starts QR pairing.
  There is deliberately no `login` subcommand. On a machine with no terminal
  (daemon, container, agent runtime) run `pingroom pair` — it prints the
  claim link, waits once, and exits 3 if the link expired. In CI, set
  `PINGROOM_TOKEN`; the CLI never prompts or draws a QR without a TTY.

Before pairing, tell the human to install or open PingRoom and sign in at
<https://pingroom.io/i>. The app receives urgent Pings, questions, approvals,
handoffs, and live progress. Installation is not consent; they must still claim
the exact robot and choose its rooms. If a headless pairing process is already
waiting, keep it running and reuse its claim link. If they leave to install,
return to that link before it expires. Do not start another pairing.

Successful pairing stores `links.latest_pings`, a stable URL for the newest
pings across granted rooms, and `links.install_app`, the token-free mobile
handoff. Both are printed by `pingroom pair --json` and by bare `pingroom`
when it reports an existing connection, not by the interactive success screen.
`links.latest_pings` contains no credential; authenticate requests to it with
the bearer saved by the CLI.

**Exit codes carry the human's answer**: 0 success/answered/acked/approved ·
1 error · 2 bad usage · 3 expired · 4 cancelled/denied/not-ready. Build shell
gates on them:

```bash
if pingroom approval -p "Ship v2 to production?" --wait; then deploy; fi
```

An approve/deny gate is the one place the *value* decides the exit code: an
answered question exits 0, but `approval --wait` exits 0 only on `approve`
and 4 on `deny`. That is what makes the one-liner above a real gate rather
than a prompt everyone passes. From CLI 0.14.0, `pingroom watch <id>` on an
approve/deny question (an `approval`, or an `ask` with no `-o`) is the same
gate: 0 on approve, 4 on deny or a tied poll, 3 expired. `ask --wait` still
exits 0 on any answer.

Blocking waits (`--wait`, `watch`) ride out an API outage. From CLI 0.14.0
they warn on stderr after three failures in a row and exit 1 ("PingRoom
unavailable since …") once the API stays down past the question's or
handoff's expiry plus 5 minutes, or after 15 minutes of failures for a `watch`
that has not read the expiry yet. Exit 1 is never an answer.

`pingroom update` updates npm global installs; `--check --json` only checks.

<!-- shared-body:start — copied verbatim into skills/openclaw/skill/SKILL.md.
     knowledge/tools/audit-knowledge.mjs fails the build if the two drift. -->

## Redeem a gift or promotional code

```bash
pingroom redeem AB12CD34EF56
pingroom redeem --code AB12CD34EF56 --json
```

Requires CLI ≥ 0.10.3. Redemption applies Pro to the human who authorized the
current connection; no room or existing Pro plan is required. Use the code
only when that person asks to redeem it. Codes contain 12 letters or digits;
surrounding whitespace and case are normalized. `PINGROOM_REDEEM_CODE` can
supply it when neither a positional code nor `--code` is passed, keeping it
out of command history. Keep codes out of room pings and logs.

Success returns the reward kind, days or package, lifetime flag, and Pro expiry.
Invalid, expired, or previously used codes fail. On `insufficient_scope`,
reconnect the credential to authorize code redemption; `pingroom:full` includes
`pingroom:codes:redeem`. Do not retry a rejected code in a loop.

## Sending pings

```bash
pingroom ping -m "Deploy finished — 3 services green"            # default room
pingroom ping --room XXXXXXXXXXXX -m "DB migrated" -t "Migration"
pingroom ping -m "Review the PR" --url https://github.com/o/r/pull/7 \
              --button-label "Open PR"                            # tappable link
pingroom ping -m "Meet here" --location 48.8584,2.2945 \
              --location-label "Eiffel Tower"                     # map ping
pingroom ping -m "Groceries" --item Milk --item Eggs --item Bread   # checklist the room ticks off
pingroom ping -m "Alarm!" --urgent                                # breaks Focus and mutes
pingroom ping -m "Confirm receipt" --require-ack --ack-mode all --ack-timeout 600
pingroom ping -m "Weekly report" --attach report.md --attach data.zip
pingroom ping -m "build 512 done" -d '{"commit":"abc123","branch":"main"}'
```

Rules that bite:
- Message ≤ 120 chars in private rooms (160 public); title ≤ 40. The CLI
  validates locally where it can, the server has the final word.
- `--attach` (repeatable, ≤ 4 files, ≤ 5 MiB each, any type — md, txt, html,
  zip, images, pdf) needs agent-token mode **and a Pro account**.
- `--ack-mode any` (default) resolves on the first eligible confirmation; `all`
  waits for every original eligible recipient. Add `--require-ack` when sending
  a ping. `actions trigger` also accepts the mode for that press. Partial
  confirmation and a wait timeout are not completion. Requires CLI ≥ 0.11.0.
- `--urgent` is delivery-only; `--require-ack` is the confirmation loop. They
  compose. Don't send `--urgent` for routine events — it trains people to
  ignore the alarm that matters.
- `-a <1-16>` attributes the ping to a quick-action slot (its icon + sound). Slots 5–16 exist only when the room owner has Pro and added those pages.

## Questions — block a script on a human choice

```bash
pingroom ask -p "Roll back or keep the canary?" \
  -o rollback:"Roll back":danger -o keep:"Keep canary":primary \
  --wait --timeout 25
# exit 0 = answered; stdout carries the chosen value
```

- 2–4 `-o value:label[:style]` options (styles: primary|danger|default); omit
  for Approve/Deny. `--text-input "<placeholder>"` invites a typed answer
  (`--text-max` ≤ 60).
- `--wait` blocks until answered/expired/cancelled; without it, `pingroom
  watch <question-id>` blocks later, `pingroom list` shows state, `pingroom
  cancel <id>` withdraws a stale question (do this — dead questions on a lock
  screen erode trust).
- `--idempotency-key` makes retried creates safe in flaky CI: reuse the same
  key when you retry. It takes 1–255 printable ASCII characters; before CLI
  0.14.0 no spaces, from 0.14.0 interior spaces too, with the ends trimmed as
  the server does. Anything else exits 2 before a request is sent.
- `--scope room` lets anyone in the room answer; the default `direct` asks the
  connecting account's human.
- `--poll` asks the whole room for a vote instead (`resolution_policy: all`):
  everyone in the room except the connecting account's human votes once, and
  votes are final. It closes once nobody who can still vote owes a vote
  (people who leave the room, delete their account or get blocked stop counting
  within about a minute), or at `--ttl` if anyone voted (no votes = expired,
  exit 3). Options only — not with `--scope direct`, `--target` or
  `--text-input`. With `--wait`, stdout is the winning value (empty on a tie,
  still exit 0) and the tally goes to stderr; `--json` returns the full
  `results`. In a room with nobody else in it the server asks a direct,
  first-answer question instead (the CLI says so on stderr); a poll nobody in
  the room can vote in fails with `ask failed` (exit 1).
- In GitHub Actions, `--github-output <name>` writes the outcome to
  `$GITHUB_OUTPUT` for later steps.

## Approvals, handoffs

```bash
pingroom approval -p "Apply 14 destructive migrations?" -c "prod-db" --wait
pingroom handoff -m "Need your call on the flaky test" --wait          # ack
pingroom handoff --question -m "Merge strategy?" -o squash:Squash -o rebase:Rebase --wait
```

`approval` is the deploy gate (approve/deny card). `handoff` reaches the
authorizing human privately — no room sees it (`--target me` is the default;
`--expires-in 120..86400`, default 900). On `recipient_not_ready`, keep the
connection and do not retry the original command until activation reports
success after the person answers its test Question. Follow the recovery
steps under Troubleshooting.

## Live progress cards

```bash
CID="migrate-$(date +%s)"
pingroom live start --room CODE -c "$CID" --template steps \
  --steps "Backup,Migrate,Verify" -m "Starting"
pingroom live update --room CODE -c "$CID" --step 1 -m "Migrating"
pingroom live end --room CODE -c "$CID" -m "All green"   # ends as done; --failed to fail
```

Templates: status · steps · progress (`--progress 0..1`) · metrics
(`--metric label:value` ×3) · countdown (`--deadline-at epoch`,
optional `--duration-seconds n` on start) · decision
(`--prompt`, `--option v:label` ×4) · matchup (`--left`/`--right`/`--center`).
The template is fixed at start; one stream per correlation id; **always end
the stream** even on error paths — trap it:
`trap 'pingroom live end --room CODE -c "$CID" --failed' ERR`.
New streams are budgeted on free accounts; updates and the final ping are
free. **Live streams are owner-only per room** — in a room the account doesn't
own, `live` fails with `forbidden`; use a room you own or send one plain ping
at the end instead.

## Hearing back / streaming

```bash
pingroom listen               # long-poll new pings in your rooms, print as they land
pingroom listen --once        # one poll cycle, then exit (cron-friendly)
```

You hear what other room members send. Everything sent as the connected
account is left out: your own sends, your human's own pings and replies, other
agents on the same account, and webhook and scheduled pings in rooms the account
owns (they are sent as the owner). To hear your human, `ask` and `watch`.
`listen` hears every room the connection covers; there is no room filter
(`--room` is a usage error), so filter the `--json` output on `room.code`
instead.

## Managing rooms, webhooks, quick actions, attachments

Room `--icon` takes a **v3 catalog id, never an emoji** (`bell`, `globe`,
`terminal`, `paperplane`, …) — run `pingroom rooms icons` to browse the
catalog; the server 422s anything off-catalog. Quick-action `--icon` is the
opposite: it takes an emoji.

```bash
pingroom rooms icons                                  # browse the icon catalog
pingroom rooms list|get <code>
pingroom rooms create -n "Deploys" --icon bell --color "#e33122"
pingroom rooms create -n "Status" --icon globe --color "#0391fe" --public --handle status
pingroom rooms create -n "Meetup" --icon globe --color "#0391fe" --public --handle meetup \
  --location "25.2048,55.2708" --location-name "Dubai Mall"   # listed in nearby discovery
pingroom rooms join <code>

pingroom webhooks list --room CODE
pingroom webhooks create --room CODE --name "CI" --action 2   # secret URL printed ONCE — store it
pingroom webhooks update <id> --room CODE --enabled false
pingroom webhooks delete <id> --room CODE

pingroom actions list --room CODE
pingroom actions set 3 --room CODE --label "Deploy done" --icon 🚀 --require-ack
pingroom actions set 4 --room CODE --label "" --icon 🔥   # emoji-only Ping (title optional)
pingroom actions set 2 --room CODE --label "Where?" --icon 📍 --input-type location  # every press must carry a detail
pingroom actions set 4 --room CODE --label "" --icon ""    # reserve the slot but disable it
# Setting up more than one slot? Use set-all — ONE request, so the owner's phone
# wakes once instead of once per slot. Slots you omit keep what they have.
pingroom actions set-all --room CODE \
  --set '{"action_number":1,"label":"Deployed","icon":"✅"}' \
  --set '{"action_number":2,"label":"Failed","icon":"❌"}'
pingroom actions trigger 3 --room CODE
# A slot with an input type needs its detail or the press is a 422 (nothing sent):
pingroom actions trigger 2 --room CODE --location "25.2048,55.2708" --location-label "Dubai Mall"  # location
pingroom actions trigger 2 --room CODE --url https://ci.example.com/run/42   # link
pingroom actions trigger 2 --room CODE --attach report.pdf                    # file / photo / pdf (Pro)
pingroom actions layout --room CODE --page-order 1,3   # keep pages 1 and 3 in that order, delete the rest (owner on Pro)

pingroom attachment get <id> --out report.md    # binary-safe download
pingroom attachment get <id> --out - | sha256sum   # bytes to stdout (CLI ≥ 0.14.0)
pingroom attachment delete <id>
```

Webhook creation and attachment upload are Pro. `--json` on any command prints
the raw response for scripting. From CLI 0.14.0, `attachment get` without
`--out` refuses to write the bytes to a terminal (exit 2); a pipe or redirect
still gets them, and `--out -` sends them to stdout on purpose.
`actions set-all` with `--set` or `--actions` requires CLI ≥ 0.10.2.
`--input-type`, the `actions trigger` detail flags, `actions layout` and
`rooms create --location` need CLI ≥ 0.12.0; `ping --item` and
`live start --duration-seconds` need CLI ≥ 0.13.0; `ask --poll` needs CLI
≥ 0.14.0. Other management nouns need CLI ≥ 0.7.6 — if `pingroom rooms`
prints "unknown command" or "Unknown option", the installed binary is older
than these docs (check which executable is on `PATH` before retrying).

<!-- shared-body:end -->

## Claude Code hook

`pingroom hook` is a ready-made Claude Code hook: it pings on Stop /
Notification events and can route tool-permission prompts to a PingRoom
question you answer from your phone. Wire it in `.claude/settings.json` hooks;
run `pingroom hook --print-config` for a
ready-to-paste settings block.

## CI patterns

```yaml
# GitHub Actions — the published action wraps this CLI.
# Webhook mode carries no account credential and needs no room: the URL is
# already room-scoped.
- uses: pingroom/cli@v0
  with:
    webhook-url: ${{ secrets.PINGROOM_WEBHOOK_URL }}
    message: "CI failed on ${{ github.ref_name }}"
    urgent: 'true'

# Token mode addresses a room explicitly. `room` is REQUIRED here — a token
# with no room exits 2, and CI has no `config set default_room` to fall back on.
# Set webhook-url OR token for a ping: when both are set, the ping goes to the
# webhook (its URL names the room) and token/room are not used for it.
- uses: pingroom/cli@v0
  with:
    token: ${{ secrets.PINGROOM_TOKEN }}
    room: ${{ secrets.PINGROOM_ROOM }}
    message: "CI failed on ${{ github.ref_name }}"
    urgent: 'true'
```

Plain shell everywhere else — the CLI is the contract. Webhook mode when the
pipeline should hold no account credential at all.

## Installing these skills elsewhere

`pingroom skills` lists both published skills and every way to install them;
`pingroom skills install` copies them into `~/.claude/skills` (needs `git`).
It refuses to replace a skill that is already installed — pass `--force` for
that, or `--dir <path>` to install somewhere else. Requires CLI >= 0.8.0.

## Troubleshooting

- `an agent token is required` → not paired here: run bare `pingroom`
  interactively, or export `PINGROOM_TOKEN`.
- `room_not_granted` → the human scoped this agent to specific rooms; they add
  more under Connected Agents in the app.
- `pro_required` → attachments/webhooks need this account upgraded; quick ping
  slots 5–16 and `actions layout` need the ROOM OWNER on Pro. Say so instead
  of retrying.
- `quick_action_input_required` → that Ping needs a detail: run
  `pingroom actions list` to see its input type, then retry with `--location`,
  `--url` or `--attach`. `quick_action_input_type` → the attachment's type does
  not match (photo = jpg/png, pdf = .pdf).
- `action_not_configured` → the slot is reserved but disabled (empty label and
  icon); configure it with `actions set` or pick another slot.
- `quick_action_layout_changed` → the pages moved since they were read; run
  `pingroom actions list` and retry. `quick_action_page_in_use` → a time
  trigger, webhook or agent binding still targets that page; retarget it first.
- `payload_too_large` (HTTP 413) → the request body exceeded the server limit:
  attachments are 5 MiB each and at most 4 per ping. `--data` is capped at
  8 KB as the server measures the JSON (each non-ASCII UTF-16 code unit counts
  6 bytes, so an emoji such as 😀 counts 12 bytes; over the cap is a 422,
  which CLI ≥ 0.14.0 refuses before sending).
- `… must not contain URL user credentials` (exit 2, CLI ≥ 0.14.0) → drop the
  `user:pass@` part from `--webhook`, `--api`, `PINGROOM_WEBHOOK_URL`,
  `PINGROOM_API_URL` or `config set api_url`; a webhook URL carries its secret
  in the path.
- `recipient_not_ready` → show the server's explanation. Have the human install
  or update PingRoom at <https://pingroom.io/i>, open it, sign in, and enable
  notifications. Then run `pingroom activate`. Do not retry the original
  command until the person answers its test Question and `pingroom activate`
  reports success; installation alone does not show that the phone is ready.
- Exit 3 after `--wait` → the human never answered in time. Treat as "no".
- Exit 1 `PingRoom unavailable since …` after a wait (CLI ≥ 0.14.0) → the API
  stayed unreachable past the deadline; no answer could be confirmed. Report
  the outage, don't act, and read the Question again after access returns.
- Config lives in `~/.pingroom/` (`PINGROOM_HOME` overrides); `pingroom config
  list` shows it.
- `insufficient_scope` → the CLI is using a legacy partial credential. Run
  `pingroom reconnect` once to replace it with a full-access credential. The old
  connection keeps working until you approve the new one; cancelling changes
  nothing. Approval revokes the old credential, so any other machine or CI job
  sharing that credential stops working. The command refuses to reconnect when
  `PINGROOM_TOKEN` is set rather than revoke a token it did not issue.
- `pingroom logout` is LOCAL ONLY: it unlinks `~/.pingroom/credentials.json`
  and leaves the connection active on the server. To replace a connection use
  `reconnect`; to end one, revoke it under Connected Agents in the app.
- An "@pingroom/cli X is available" line on stderr is the once-a-day update
  notice, not an error. It never changes stdout or the exit code, and is already
  suppressed in CI; `PINGROOM_NO_UPDATE_CHECK=1` silences it everywhere.
