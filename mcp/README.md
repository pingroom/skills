<p align="center">
  <img alt="PingRoom MCP — Reach a human from your AI agent" src="https://shieldcn.dev/header/gradient.svg?title=PingRoom+MCP&amp;subtitle=Reach+a+human+from+your+AI+agent&amp;mode=dark" />
</p>

<p align="center">
  <a href="https://github.com/pingroom/skills"><img alt="GitHub stars" src="https://shieldcn.dev/github/stars/pingroom/skills.svg" /></a>
  <a href="https://pingroom.io/connect-mcp.md"><img alt="Transport: HTTP" src="https://shieldcn.dev/badge/transport-HTTP-e33122.svg" /></a>
  <a href="https://pingroom.io/auth.md"><img alt="Authentication: OAuth" src="https://shieldcn.dev/badge/auth-OAuth-e33122.svg" /></a>
</p>

# PingRoom MCP

## Overview

Give your AI agent a way to reach you on your phone. PingRoom's hosted MCP
connector sends pings, asks questions, requests approvals, shares files and
locations, and shows live progress on your lock screen.

- Get a ping when an agent finishes or needs your attention.
- Answer a question or approve the next step from your phone.
- Ask one person—or every eligible room member—to confirm a ping.
- Follow long tasks through a live progress card.

The connector runs at `https://api.pingroom.io/api/agent/mcp`. You authorize
it in your browser and choose which rooms its robot can access. There is no
MCP server to run locally and no API key to paste into your client.

**Included:** the [PingRoom MCP skill](skills/pingroom-mcp/SKILL.md),
a [42-tool reference](skills/pingroom-mcp/references/tools.md), and plugin
configurations for Claude Code, Grok Build, and Cursor.

## Table of contents

- [Install](#install)
- [First ping](#first-ping)
- [Use cases](#use-cases)
- [Agent skill](#agent-skill)
- [Connection and permissions](#connection-and-permissions)
- [CLI and SDK](#cli-and-sdk)
- [Project activity](#project-activity)

## Install

[Install or open PingRoom on your phone](https://pingroom.io/i) and sign in,
then choose your client:

| Client | Setup | Authorize |
|---|---|---|
| **Claude Code** | [Install the plugin](#claude-code-plugin) with the skill and server configuration | Open `/mcp`, select PingRoom, and authenticate |
| **Grok Build** | `grok plugin install pingroom/skills#mcp` | Open `/mcps` and authenticate PingRoom |
| **Cursor** | [Import the repository or load the local plugin](../README.md#for-cursor) | Open **Customize** and authenticate PingRoom |
| **Codex CLI** | [Add the hosted server](#codex-cli) | Run `codex mcp login pingroom` |
| **Other MCP clients** | Add `https://api.pingroom.io/api/agent/mcp` as a remote HTTP server | Use the client's OAuth connection flow |

### Claude Code plugin

Run inside Claude Code:

```text
/plugin marketplace add pingroom/skills
/plugin install pingroom-mcp
```

The plugin supplies both the skill and the server configuration. Open `/mcp`
and authenticate PingRoom. If you prefer to add only the server:

```bash
claude mcp add --transport http pingroom https://api.pingroom.io/api/agent/mcp
```

### Codex CLI

```bash
codex mcp add pingroom --url https://api.pingroom.io/api/agent/mcp
codex mcp login pingroom
```

For client-specific OAuth steps and configuration examples, see the
[MCP connection guide](https://pingroom.io/connect-mcp.md).

## First ping

After authorizing, ask your agent:

> Check which PingRoom account and rooms you're connected to, then send
> “Connected and ready” to my Deploys room.

The agent checks `connection_info`, finds the room with `list_rooms`, and
sends the message with `broadcast`. For a personal room, it uses
`trigger_quick_action` instead. The [skill](skills/pingroom-mcp/SKILL.md)
explains how to select the right tool.

## Use cases

| Ask your agent | Tools it uses |
|---|---|
| “Ping the Deploys room when the tests finish.” | `broadcast` |
| “Ask everyone in Operations to confirm the maintenance window.” | `broadcast` with `requires_ack: true`, `ack_mode: "all"`; then `wait_for_ack` |
| “Ask me whether to deploy to staging or production, and wait.” | `ask_question`, then `wait_for_answer` |
| “Get my approval before making the change.” | `ask_question` with approve/deny options, then `wait_for_answer` |
| “Send this report to my phone.” | `upload_attachment`, then `broadcast` |
| “Hand this decision to the person who connected you.” | `create_handoff`, then `wait_for_handoff` |
| “Show progress on my lock screen while you work.” | `live_status` with `running` updates, then `done` or `failed` |

A successful send means PingRoom accepted the request. Confirmation and
decision tools let the agent wait for a person's response. A pending or
expired request is not approval; the agent must check the actual answer
before continuing. Live progress ends when the task finishes.

## Agent skill

The [skill](skills/pingroom-mcp/SKILL.md) teaches connection checks, room
selection, confirmation and decision flows, attachment limits, and handling
retries without duplicate pings. Exact parameters live in the
[tool reference](skills/pingroom-mcp/references/tools.md).

Claude Code and Grok Build plugins include it; the Cursor manifest points to
the same file. Adding only the MCP URL exposes the tools but does not install
the skill. For manual and CLI-based skill installation, see the
[repository install guide](../README.md#install).

## Connection and permissions

Authorization creates a separate PingRoom robot. The person claiming it
chooses its room access. Check `connection_info` after connecting or changing
accounts, and refresh `list_rooms` after an account switch.

To disconnect, call `disconnect` before removing the client's local login.
If already logged out, revoke the connection in **PingRoom → Settings →
Connected Agents**. See [disconnect or switch accounts](https://pingroom.io/connect-mcp.md#disconnect-or-switch-accounts).

## CLI and SDK

Use the [CLI](https://github.com/pingroom/cli) for shell scripts, CI, larger
attachments, or Claude Code hooks. Use the
[TypeScript SDK](https://github.com/pingroom/sdk) when building your own integration.
Both connect separately from your MCP client's OAuth login.

## Project activity

The hosted connector is not an npm package. This chart tracks the public
skills and plugins repository.

<p align="center">
  <a href="https://github.com/pingroom/skills"><img alt="GitHub star history for the PingRoom skills and plugins repository" src="https://shieldcn.dev/chart/github/stars/pingroom/skills.svg?color=e33122&amp;title=PingRoom+skills+and+plugins" /></a>
</p>
