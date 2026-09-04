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
  Only `ping` supports it.
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

`approval` is the only command where the *value* decides the exit code: an
answered question exits 0, but an answered APPROVAL exits 0 only on `approve`
and 4 on `deny`. That is what makes the one-liner above a real gate rather
than a prompt everyone passes.

<!-- shared-body:start — copied verbatim into skills/openclaw/skill/SKILL.md.
     knowledge/tools/audit-knowledge.mjs fails the build if the two drift. -->

## Sending pings

```bash
pingroom ping -m "Deploy finished — 3 services green"            # default room
pingroom ping --room XXXXXXXXXXXX -m "DB migrated" -t "Migration"
pingroom ping -m "Review the PR" --url https://github.com/o/r/pull/7 \
              --button-label "Open PR"                            # tappable link
pingroom ping -m "Meet here" --location 48.8584,2.2945 \
              --location-label "Eiffel Tower"                     # map ping
pingroom ping -m "Alarm!" --urgent                                # breaks Focus
pingroom ping -m "Confirm receipt" --require-ack --ack-timeout 600
pingroom ping -m "Weekly report" --attach report.md --attach data.zip
pingroom ping -m "build 512 done" -d '{"commit":"abc123","branch":"main"}'
```

Rules that bite:
- Message ≤ 120 chars in private rooms (160 public); title ≤ 40. The CLI
  validates locally where it can, the server has the final word.
- `--attach` (repeatable, ≤ 4 files, ≤ 5 MiB each, any type — md, txt, html,
  zip, images, pdf) needs agent-token mode **and a Pro account**.
- `--urgent` is delivery-only; `--require-ack` is the confirmation loop. They
  compose. Don't send `--urgent` for routine events — it trains people to
  ignore the alarm that matters.
- `-a <1-4>` attributes the ping to a quick-action slot (its icon + sound).

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
- `--idempotency-key` makes retried creates safe in flaky CI.
- `--scope room` lets anyone in the room answer; the default `direct` asks the
  connecting account's human.
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
pingroom live update -c "$CID" --step 1 -m "Migrating"
pingroom live end -c "$CID" -m "All green"        # ends as done; --failed to fail
```

Templates: status · steps · progress (`--progress 0..1`) · metrics
(`--metric label:value` ×3) · countdown (`--deadline-at epoch`) · decision
(`--prompt`, `--option v:label` ×4) · matchup (`--left`/`--right`/`--center`).
The template is fixed at start; one stream per correlation id; **always end
the stream** even on error paths — trap it:
`trap 'pingroom live end -c "$CID" --failed' ERR`.
New streams are budgeted on free accounts; updates and the final ping are
free. **Live streams are owner-only per room** — in a room the account doesn't
own, `live` fails with `forbidden`; use a room you own or send one plain ping
at the end instead.

## Hearing back / streaming

```bash
pingroom listen               # long-poll new pings in your rooms, print as they land
pingroom listen --once        # one poll cycle, then exit (cron-friendly)
```

Your own sends are excluded. For one specific reply, prefer `ask`/`watch`.

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
pingroom rooms join <code>

pingroom webhooks list --room CODE
pingroom webhooks create --room CODE --name "CI" --action 2   # secret URL printed ONCE — store it
pingroom webhooks update <id> --room CODE --enabled false
pingroom webhooks delete <id> --room CODE

pingroom actions list --room CODE
pingroom actions set 3 --room CODE --label "Deploy done" --icon 🚀 --require-ack
pingroom actions set 4 --room CODE --label "" --icon 🔥   # emoji-only Ping (title optional)
# Setting up more than one slot? Use set-all — ONE request, so the owner's phone
# wakes once instead of once per slot. Slots you omit keep what they have.
pingroom actions set-all --room CODE \
  --set '{"action_number":1,"label":"Deployed","icon":"✅"}' \
  --set '{"action_number":2,"label":"Failed","icon":"❌"}'
pingroom actions trigger 3 --room CODE

pingroom attachment get <id> --out report.md    # binary-safe download
pingroom attachment delete <id>
```

Webhook creation and attachment upload are Pro. `--json` on any command prints
the raw response for scripting. `actions set-all` with `--set` or `--actions`
requires CLI ≥ 0.10.1. Other management nouns need CLI ≥ 0.7.6 — if `pingroom rooms`
prints "unknown command", the installed binary is older than these docs
(`npm i -g @pingroom/cli` to update, or run from a checkout).

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
- `pro_required` → attachments/webhooks need the account upgraded; say so
  instead of retrying.
- `recipient_not_ready` → show the server's explanation. Have the human install
  or update PingRoom at <https://pingroom.io/i>, open it, sign in, and enable
  notifications. Then run `pingroom activate`. Do not retry the original
  command until the person answers its test Question and `pingroom activate`
  reports success; installation alone does not show that the phone is ready.
- Exit 3 after `--wait` → the human never answered in time. Treat as "no".
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
