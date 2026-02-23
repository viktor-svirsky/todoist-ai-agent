# @ai Comment Trigger Design

**Date:** 2026-02-23

## Problem

The current trigger requires adding an "AI" label to a task, which is a friction-heavy workflow. The user must label a task before the agent can respond to it.

## Solution

Replace label-based triggers with a comment mention trigger: any comment containing `@ai` (case-insensitive) on any task will invoke the agent.

## Changes

### Removed
- `item:added` webhook handler (label-based task trigger)
- `item:updated` webhook handler (label-based task trigger)
- `hasAiLabel()` Todoist API call
- `AI_LABEL` constant and config field

### Modified
- `note:added` handler: check for `@ai` in comment content instead of checking for AI label on the task
- Strip `@ai` from comment content before passing to Claude
- `item:completed` handler: remove AI label check (or remove handler entirely)

## Flow

1. User adds comment `@ai find cheapest flights to Paris for next Friday` on any task
2. Webhook fires `note:added`
3. Handler detects `@ai` in content
4. Content is stripped of `@ai` and sent to Claude with conversation history
5. Claude responds; response is posted as a comment on the same task
6. Subsequent `@ai` comments continue the conversation with full context

## What Stays the Same

- Conversation history per task (keyed by task ID)
- Bot ignores its own comments (loop prevention)
- Response posted as a comment on the same task
- HMAC webhook verification
