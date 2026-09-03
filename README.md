# PingRoom agent skills

Ready-to-install skills for reaching humans through
[PingRoom](https://pingroom.io) — pings, files, locations, questions, approvals,
handoffs, and lock-screen live progress. Two are
[Claude Code](https://code.claude.com/docs) plugins; the third is for
[OpenClaw](https://docs.openclaw.ai).

| Skill | Use it for |
|---|---|
| [`pingroom-mcp`](mcp/skills/pingroom-mcp/SKILL.md) | The hosted MCP connector (`https://api.pingroom.io/api/agent/mcp`) — conversational agents: retain a latest-pings feed URL; send pings with locations, links, structured data, and small attachments; ask questions; gate on approvals; hand decisions to your human; drive live-progress cards. Includes a full 39-tool reference generated from the live `tools/list`. |
| [`pingroom-cli`](cli/skills/pingroom-cli/SKILL.md) | The [`@pingroom/cli`](https://www.npmjs.com/package/@pingroom/cli) — shells, CI, and Claude Code hooks: attachments up to 5 MiB, exit-code gates on human answers, room/webhook/quick-action management. |
| [`pingroom`](openclaw/skill/SKILL.md) (OpenClaw) | The same CLI, packaged for [OpenClaw](https://docs.openclaw.ai) agents: headless pairing with `pingroom pair`, `skills.entries` credential wiring, and the sandbox caveat. Not a Claude Code plugin — see [Install for OpenClaw](#for-openclaw). |

The first two are Claude Code siblings and cross-reference each other: the MCP
skill defers to the CLI one for shell work, and the CLI skill defers to MCP for
conversational work. Installing both is the intended setup there. The OpenClaw
skill shares the CLI skill's command body verbatim — a marked region kept in
lockstep by `knowledge/tools/audit-knowledge.mjs` — and swaps the Claude Code
specifics for OpenClaw's.

## Install

### As Claude Code plugins (recommended — stays updated)

```
/plugin marketplace add pingroom/skills
/plugin install pingroom-mcp
/plugin install pingroom-cli
```

### With the PingRoom CLI

```bash
npm i -g @pingroom/cli
pingroom skills install
```

Installs both into `~/.claude/skills/`. Add `--force` to replace skills already
there, or `--dir <path>` to install elsewhere.

### By hand

```bash
git clone https://github.com/pingroom/skills.git /tmp/pingroom-skills
cp -r /tmp/pingroom-skills/mcp/skills/pingroom-mcp ~/.claude/skills/
cp -r /tmp/pingroom-skills/cli/skills/pingroom-cli ~/.claude/skills/
```

### For OpenClaw

The OpenClaw skill is not a Claude Code plugin and is not installed by
`pingroom skills install`. It publishes to ClawHub as
[`@pingroom/pingroom`](https://clawhub.ai/pingroom/pingroom):

```bash
openclaw skills install @pingroom/pingroom        # add --global to share it
```

Or from a clone:

```bash
git clone https://github.com/pingroom/skills.git
openclaw skills install ./skills/openclaw/skill
```

(`openclaw skills install git:…` expects `SKILL.md` at the repository root, so
the clone form is the one that works for a skill in a subdirectory.)

The channel plugin beside it publishes to npm as
[`@pingroom/openclaw-plugin`](https://www.npmjs.com/package/@pingroom/openclaw-plugin):

```bash
openclaw plugins install npm:@pingroom/openclaw-plugin
```

Have the person install or open PingRoom and sign in before pairing:
<https://pingroom.io/i>. The app receives urgent Pings, questions, approvals,
handoffs, and live progress. Installation is not consent; they must still use
the claim link to claim the exact robot and choose its rooms. If a pairing is
already pending, keep it running and return to the same claim link after
installation and before it expires. Do not start another pairing.

Then connect the CLI without a terminal:

```bash
pingroom pair          # prints an approval link; approve it on your phone
```

Full guide: https://pingroom.io/connect-openclaw.md

## Connect

**Installing the `pingroom-mcp` plugin now wires up the MCP server too** — its
`plugin.json` declares it, so there is no separate `claude mcp add`. You still
authenticate once: run `/mcp`, pick **pingroom**, choose **Authenticate**, and
approve in the browser (or by scanning the QR with the PingRoom app).

Added it by hand before? Your own entry wins — Claude Code resolves MCP servers
local > project > user > plugin, so the plugin's copy is ignored and nothing
breaks. To switch to the plugin-managed one:

```bash
claude mcp remove pingroom
```

Note the tool names differ between the two: `mcp__pingroom__<name>` for a server
you added yourself, `mcp__plugin_pingroom_mcp_pingroom__<name>` for the
plugin's. OAuth tokens are keyed by endpoint URL, so switching does not make you
sign in again.

If you are not using plugins, add the server directly:

```bash
claude mcp add --transport http pingroom https://api.pingroom.io/api/agent/mcp
```

The `pingroom-cli` skill needs a paired CLI: `npm i -g @pingroom/cli && pingroom`.
New connections receive full agent access. If a legacy credential reports
`insufficient_scope`, run `pingroom reconnect` once to replace it with a
full-access credential.

## Layout

Each top-level directory is one Claude Code plugin, in the standard layout — a
`.claude-plugin/plugin.json` beside a `skills/` directory whose subdirectory
name matches the skill's frontmatter `name`:

```
.claude-plugin/marketplace.json   both plugins, for /plugin marketplace add
mcp/
  .claude-plugin/plugin.json     also declares the hosted MCP server
  skills/pingroom-mcp/SKILL.md
  skills/pingroom-mcp/references/tools.md
cli/
  .claude-plugin/plugin.json
  skills/pingroom-cli/SKILL.md
openclaw/
  skill/SKILL.md                 OpenClaw skill — flat, no plugin.json
```

`openclaw/` is deliberately outside `marketplace.json`: OpenClaw has no
`plugin.json`, and listing it as a Claude Code plugin would install a second,
near-identical skill beside `pingroom-cli`.

## More

- Agent integration guide: https://pingroom.io/agent.md
- Auth protocol: https://pingroom.io/auth.md
- MCP connector guide: https://pingroom.io/connect-mcp.md
- OpenClaw guide: https://pingroom.io/connect-openclaw.md
