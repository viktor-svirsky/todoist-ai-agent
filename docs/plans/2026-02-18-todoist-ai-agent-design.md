# Todoist AI Agent — Design Doc

**Date:** 2026-02-18
**Status:** Approved

## Overview

A Node.js agent that monitors Todoist tasks labeled "AI" and responds to them autonomously using Claude (claude-opus-4-6) with access to Playwright MCP (browser), shell execution, and the Todoist REST API. All communication happens via Todoist task comments.

## Trigger Events

Subscribes to Todoist webhooks at `https://9635783.xyz:9000/webhook`:

| Event | Condition | Action |
|---|---|---|
| `item:added` | task has "AI" label | Run agent on title + description |
| `item:updated` | "AI" label just added (task_id not in store) | Run agent on title + description |
| `item:completed` | task has "AI" label | Post summary, clean up conversation history |
| `comment:added` | task has "AI" label, comment not from bot | Run agent on comment text |

## Architecture

```
Todoist → webhook POST → Express (port 9000) → async job queue → Agent Loop → Todoist comment
                                                                       ↓
                                                             Claude (claude-opus-4-6)
                                                                  ↙  ↓  ↘
                                                       Playwright  Shell  Todoist REST
                                                         MCP       tool    (read/write)
```

**Key design decision:** webhook responds `200 OK` immediately, processing happens asynchronously in a background worker to avoid Todoist retry storms.

## File Structure

```
todoist-ai-agent/
├── server.js              # Express app, webhook endpoint, async job queue
├── agent.js               # Claude Agent SDK loop, MCP client setup
├── todoist.js             # Todoist REST API client (fetch task, post comment)
├── store.js               # Conversation history r/w (data/conversations.json)
├── tools/
│   └── shell.js           # Custom shell execution tool for Claude
├── data/
│   └── conversations.json # Persisted conversation history keyed by task_id
├── .env                   # ANTHROPIC_API_KEY, TODOIST_API_TOKEN, WEBHOOK_SECRET
├── com.user.todoist-ai-agent.plist  # launchd daemon config
└── package.json
```

## Data Model

**`data/conversations.json`:**
```json
{
  "task_12345": {
    "title": "Research best NoSQL databases",
    "messages": [
      { "role": "user", "content": "Research best NoSQL databases for time-series data" },
      { "role": "assistant", "content": "I'll research this for you..." }
    ],
    "createdAt": "2026-02-18T10:00:00Z",
    "lastActivityAt": "2026-02-18T10:05:00Z"
  }
}
```

**Pruning:** keep last 20 messages per task. Always preserve the first user message (task context anchor). Drop oldest pairs when limit exceeded.

## Agent System Prompt

```
You are an AI assistant embedded in Viktor's Todoist.
You help solve tasks by reasoning, browsing the web, and running shell commands on a Mac mini.
The current task is: "{task.title}"
Task description: "{task.description}"
Respond concisely — your reply will be posted as a Todoist comment.
```

## Claude Tools

| Tool | Source | Purpose |
|---|---|---|
| Browser tools | Playwright MCP (stdio) | Web browsing, scraping, UI interaction |
| `run_shell` | `tools/shell.js` | Execute shell commands on Mac mini (30s timeout) |
| Todoist read | `todoist.js` | Fetch task details, existing comments |

## Loop Guard

On startup, fetch the Todoist bot user UID once and cache it. Skip any `comment:added` webhook where `comment.posted_by_uid === botUid`. Prevents infinite reply loops.

## Error Handling

| Scenario | Behavior |
|---|---|
| Claude API fails | Post: "⚠️ AI agent error: [message]. Retry by adding a comment." |
| Playwright times out | Post: "⚠️ Browser task timed out after 60s." |
| Shell command hangs | Kill after 30s, post error comment |
| Todoist API fails | Log to file, retry once after 5s |
| Webhook HMAC invalid | Return 403, log warning |

## Deployment

- **Process manager:** launchd daemon (`com.user.todoist-ai-agent.plist`)
- **Auto-restart:** on crash
- **Logs:** `~/Library/Logs/todoist-ai-agent.log`
- **Port:** 9000 (shared with existing setup — agent mounts at `/webhook` path)
- **Env vars:** `ANTHROPIC_API_KEY`, `TODOIST_API_TOKEN`, `TODOIST_WEBHOOK_SECRET`, `BOT_UID`

## Setup Steps

1. `npm install` in `todoist-ai-agent/`
2. Copy `.env.example` → `.env`, fill in credentials
3. Register Todoist webhook via API (one-time)
4. Install launchd plist → `launchctl load`
5. Test with a real "AI"-labeled task
