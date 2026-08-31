# PingRoom agent skills

Ready-to-install [Claude Code skills](https://code.claude.com/docs) for reaching
humans through [PingRoom](https://pingroom.io) — pings, files, locations,
questions, approvals, handoffs, and lock-screen live progress.

| Skill | Use it for |
|---|---|
| [`pingroom-mcp`](mcp/skills/pingroom-mcp/SKILL.md) | The hosted MCP connector (`https://api.pingroom.io/api/agent/mcp`) — conversational agents: send pings with locations, links, structured data, and small attachments; ask questions; gate on approvals; hand decisions to your human; drive live-progress cards. Includes a full 38-tool reference generated from the live `tools/list`. |
| [`pingroom-cli`](cli/skills/pingroom-cli/SKILL.md) | The [`@pingroom/cli`](https://www.npmjs.com/package/@pingroom/cli) — shells, CI, and Claude Code hooks: attachments up to 5 MiB, exit-code gates on human answers, room/webhook/quick-action management. |

The two are siblings and cross-reference each other: the MCP skill defers to the
CLI one for shell work, and the CLI skill defers to MCP for conversational work.
Installing both is the intended setup.

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
If an already-paired CLI reports `insufficient_scope`, run `pingroom reconnect`.

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
```

## More

- Agent integration guide: https://pingroom.io/agent.md
- Auth protocol: https://pingroom.io/auth.md
- MCP connector guide: https://pingroom.io/connect-mcp.md
