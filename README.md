# PingRoom agent skills

Ready-to-install [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code)
for reaching humans through [PingRoom](https://pingroom.io) — pings, files,
locations, questions, approvals, handoffs, and lock-screen live progress.

| Skill | Use it for |
|---|---|
| [`mcp/`](mcp/SKILL.md) | The hosted MCP connector (`https://api.pingroom.io/api/agent/mcp`) — conversational agents: send pings with locations, links, structured data, and small attachments; ask questions; gate on approvals; hand decisions to your human; drive live-progress cards. Includes a full 27-tool reference generated from the live `tools/list`. |
| [`cli/`](cli/SKILL.md) | The [`@pingroom/cli`](https://www.npmjs.com/package/@pingroom/cli) — shells, CI, and Claude Code hooks: attachments up to 5 MiB, exit-code gates on human answers, room/webhook/quick-action management. |

## Install

```bash
# Claude Code (personal skills)
git clone https://github.com/pingroom/skills.git /tmp/pingroom-skills
cp -r /tmp/pingroom-skills/mcp  ~/.claude/skills/pingroom-mcp
cp -r /tmp/pingroom-skills/cli  ~/.claude/skills/pingroom-cli
```

Connect the MCP server (OAuth, scan the QR with the PingRoom app to approve):

```bash
claude mcp add --transport http pingroom https://api.pingroom.io/api/agent/mcp
```

Or pair the CLI: `npm i -g @pingroom/cli && pingroom`.

## More

- Agent integration guide: https://pingroom.io/agent.md
- Auth protocol: https://pingroom.io/auth.md
- MCP connector guide: https://pingroom.io/connect-mcp.md
