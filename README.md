# PingRoom agent skills

Ready-to-install skills for reaching humans through
[PingRoom](https://pingroom.io) — pings, files, locations, questions, approvals,
handoffs, and lock-screen live progress. Two are plugins and install in both
[Claude Code](https://code.claude.com/docs) and
[Grok Build](https://docs.x.ai/build/overview); the third is for
[OpenClaw](https://docs.openclaw.ai).

| Skill | Use it for |
|---|---|
| [`pingroom-mcp`](mcp/skills/pingroom-mcp/SKILL.md) | The hosted MCP connector (`https://api.pingroom.io/api/agent/mcp`) — conversational agents: retain a latest-pings feed URL; send pings with locations, links, structured data, and small attachments; ask questions; gate on approvals; hand decisions to your human; drive live-progress cards. Includes a full 41-tool reference generated from the live `tools/list`. |
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

### As Grok Build plugins

Grok Build reads the same `.claude-plugin/plugin.json` manifests, so both
plugins install straight from this repo — `#mcp` and `#cli` select the
subdirectory:

```bash
grok plugin install pingroom/skills#mcp
grok plugin install pingroom/skills#cli
```

They are also submitted to the [official xAI
marketplace](https://github.com/xai-org/plugin-marketplace), which Grok Build
ships as a configured source. Once the catalog entry lands, `/marketplace`
inside Grok Build lists them and the repo path is no longer needed:

```bash
grok plugin install pingroom-mcp
grok plugin install pingroom-cli
```

Either way the plugins install under their manifest names, `pingroom-mcp` and
`pingroom-cli` — that is what `grok plugin list`, `details` and `uninstall`
expect. Grok resolves the MCP server from `mcp/.mcp.json`; authenticate once
with `/mcps`.

### For Cursor

The `pingroom-mcp` plugin includes a Cursor manifest and uses the same skill
and hosted MCP configuration as the Claude Code and Grok versions. To load it
locally from a clone:

```bash
git clone https://github.com/pingroom/skills.git
mkdir -p ~/.cursor/plugins/local
ln -s "$(pwd)/skills/mcp" ~/.cursor/plugins/local/pingroom-mcp
```

Reload Cursor, open **Customize**, and authenticate PingRoom in the browser.
The person authorizing the connection chooses the account and allowed rooms.
Local plugin imports must be enabled by your team if they are restricted.

The repository's `.cursor-plugin/marketplace.json` exposes the same plugin for
Cursor's repository import. Marketplace availability depends on review; the
manifest alone does not publish a listing. [Cursor plugin documentation](https://cursor.com/docs/plugins).

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
openclaw plugins install npm:@pingroom/openclaw-plugin@0.1.4
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
The public MCP catalog contains 41 tools. New connections receive the single
`pingroom:full` consent grant, which expands to the server's 18 internal
permissions, including changes to the robot's profile. If a legacy credential
reports `insufficient_scope`, run `pingroom reconnect` once to replace it with
a full-access credential.

## Redeem gifted codes

All integrations redeem gift and promotional codes for the human who authorized
their current connection. No room or existing Pro plan is needed.

| Integration | Command or tool |
|---|---|
| MCP, including the Grok MCP plugin | `redeem_code { "code": "AB12CD34EF56" }` |
| CLI, including the Grok CLI plugin | `pingroom redeem AB12CD34EF56` (CLI ≥ 0.10.3) |
| Native OpenClaw plugin | `pingroom_redeem_code` or `/pingroom redeem AB12CD34EF56` (plugin ≥ 0.1.4, owner in a private session) |
| OpenClaw standalone skill | `pingroom redeem AB12CD34EF56` (skill ≥ 1.0.3, CLI ≥ 0.10.3) |

Update installed plugins to receive the new instructions. The native OpenClaw
tool works without the CLI. Legacy credentials may need reconnection to grant
`pingroom:codes:redeem`, which is included in `pingroom:full`.

## Layout

Each top-level directory is one plugin, in the standard layout — a
`.claude-plugin/plugin.json` beside a `skills/` directory whose subdirectory
name matches the skill's frontmatter `name`. Grok Build accepts the same
manifest, so there is no second Grok-specific copy to keep in lockstep:

```
.claude-plugin/marketplace.json   both plugins, for /plugin marketplace add
.cursor-plugin/marketplace.json   hosted MCP plugin, for Cursor repository import
mcp/
  .claude-plugin/plugin.json     also declares the hosted MCP server
  .cursor-plugin/plugin.json     points to the same skill and MCP configuration
  .mcp.json                      the same server, where Grok Build looks
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
