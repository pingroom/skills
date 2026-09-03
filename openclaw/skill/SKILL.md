---
name: pingroom
description: >-
  Reach a human through PingRoom from an OpenClaw agent using the `pingroom`
  CLI — send a ping to their phone (with files up to 5 MiB, tappable links, map
  locations, or an acknowledgement request), ask a question and block until they
  answer, gate an action on approve/deny, hand a decision to your authorizing
  human, drive a lock-screen live-progress card, and stream incoming pings. Use
  it whenever the task means "notify me", "let me know when it's done", "ask me
  before deploying", "send this to my phone", "ping the team", or any step that
  needs a real human decision rather than a guess. Pairing works without a
  terminal: `pingroom pair --agent-label "OpenClaw"` creates a separate robot
  profile and prints its claim link.
version: 1.0.0
homepage: https://pingroom.io/connect-openclaw.md
user-invocable: true
metadata:
  {
    "openclaw":
      {
        "emoji": "📣",
        "homepage": "https://pingroom.io/connect-openclaw.md",
        "requires": { "bins": ["pingroom"] },
        "primaryEnv": "PINGROOM_TOKEN",
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "@pingroom/cli",
              "bins": ["pingroom"],
              "label": "Install @pingroom/cli (npm)",
            },
          ],
      },
  }
---

# PingRoom: reach a human from an OpenClaw agent

`pingroom` is a Node ≥ 20 CLI that turns a step in your work into an event on a
person's phone — a push they feel, a card on their lock screen, a question they
answer with one tap — and turns their answer back into an exit code you can
branch on. Requires `@pingroom/cli` ≥ 0.10.0.

## Connect first (no terminal needed)

OpenClaw runs as a daemon, so there is no terminal to scan a QR with. Use the
headless flow:

```bash
pingroom pair --agent-label "OpenClaw"
```

It creates an OpenClaw robot profile, prints its claim link, and waits. **Relay
that link to the human** — send it in the current conversation — and include the
robot name and `@handle` when printed so they know exactly what they are
claiming. The link expires in 15 minutes. On their phone they sign in, claim the
robot, and choose which rooms it may reach. The robot acts for them; it does not
become their personal PingRoom profile.

The command is long-running: OpenClaw backgrounds it after a few seconds, so
follow it with the `process` tool to read the link and to see the result. Exit
0 means paired; exit 3 means the link expired — run it again for a fresh one.
Re-running the labeled command when already paired creates a replacement
connection and revokes the previous one only after the replacement is saved.

`pingroom pair --agent-label "OpenClaw" --json` prints one JSON object per line
instead (`{"event":"pair_url",…}` first, `{"event":"connected",…}` last),
which is easier to parse out of a process log. New servers include
`agent.profile` identity fields — display name, handle, and avatar — in the
pairing record; older servers omit them. The
connected record includes `links.latest_pings`, a stable URL for reading the
newest pings later. Neither record prints the credential; the bearer remains in
the saved credential file.

### Or use a token

If the human already has a PingRoom agent credential, skip pairing entirely and
put it in the skill's config instead of pairing:

```json5
{
  skills: {
    entries: {
      pingroom: {
        env: { PINGROOM_TOKEN: "…", PINGROOM_ROOM: "ab12cd" },
      },
    },
  },
}
```

`apiKey` works too and maps onto `PINGROOM_TOKEN` (this skill declares it as
its `primaryEnv`), including as a SecretRef:
`apiKey: { source: "env", provider: "default", id: "PINGROOM_TOKEN" }`.

**Sandbox caveat:** `skills.entries.*.env` is injected into the *host* agent
run, not into a sandboxed `exec`. If your agent runs sandboxed, either put the
credential in `agents.defaults.sandbox.docker.env` or mount a `PINGROOM_HOME`
holding `credentials.json` into the container.

## Auth model — pick the mode before the flags

- **Agent credential** (default): the claimed robot's credential in
  `~/.pingroom/credentials.json` (or `$PINGROOM_HOME/credentials.json`), or
  `PINGROOM_TOKEN`, plus `--room <code>` / `PINGROOM_ROOM` /
  `pingroom config set default_room <code>`. Full feature set.
- **Webhook mode**: `pingroom ping -w <webhook-url>` — the URL carries its own
  secret, no account needed. Only `ping` supports it.

**Exit codes carry the human's answer**: 0 success/answered/acked/approved ·
1 error · 2 bad usage · 3 expired · 4 cancelled/denied/not-ready.

```bash
if pingroom approval -p "Ship v2 to production?" --wait; then deploy; fi
```

`approval` is the only command where the *value* decides the exit code: an
answered question exits 0, but an answered APPROVAL exits 0 only on `approve`
and 4 on `deny`. That is what makes the one-liner above a real gate rather
than a prompt everyone passes.

<!-- shared-body:start — verbatim copy of the same region in
     skills/cli/skills/pingroom-cli/SKILL.md. Edit there, then re-copy; the two
     are compared by knowledge/tools/audit-knowledge.mjs. -->

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
`--expires-in 120..86400`, default 900). If
the recipient's device isn't ready, `pingroom activate` sends the one-tap
Agent Inbox activation, then retry.

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
the raw response for scripting. The management nouns need CLI ≥ 0.7.6 — if `pingroom rooms`
prints "unknown command", the installed binary is older than these docs
(`npm i -g @pingroom/cli` to update, or run from a checkout).

<!-- shared-body:end -->

## Waiting for a human under OpenClaw

`--wait` blocks until the human answers or the TTL runs out — minutes, not
seconds. OpenClaw backgrounds a command that runs past its yield window and
hands you the `process` tool to follow it, so a long wait is normal and does
not need a shorter TTL. Two rules:

- **Never report a timeout as an answer.** Exit 3 means the question expired
  with nobody answering; exit 4 means they said no. Say which one happened.
- **Only open a gate you intend to stay alive for.** If your run ends while a
  question is open, the human's answer is still recorded and readable later
  with `pingroom list --state answered`, but nothing wakes you to act on it.

## Troubleshooting

- `an agent token is required` — not connected. Run the labeled pairing command
  above and relay the robot identity with the link, or set `PINGROOM_TOKEN` in
  `skills.entries.pingroom.env`.
- Bare `pingroom` printing "not connected" is expected on a daemon: it will not
  start a 15-minute pairing poll from a non-interactive shell. Use
  `pingroom pair --agent-label "OpenClaw"`, which asks for exactly that.
- `403 room_not_granted` — the room is outside what the human approved. Widen
  it under Agents in the PingRoom app, or run the labeled pairing command again.
- `403 insufficient_scope` — the credential has a legacy partial grant. Run
  the labeled pairing command once to replace it with a full-access credential.
- `402 pro_required` — attachments and webhook management need a Pro account.
- `pingroom logout` only clears the local file; the server-side credential stays
  live. Revoke it under Agents, or let the labeled pairing command do it.

## Reference

Full command reference: https://pingroom.io/connect-openclaw.md
