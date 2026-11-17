# Agents and features people miss

Pairs with Phase 2. 90 to 120 minutes, hands on.

**Goal:** Build and share agents and show staff the features that save time.

## Exercise

1. Build an agent with file search, share it with a group.
2. Wire a handoff from one agent to another; use artifacts in a chat.
3. Trigger an approval card (Outlook draft), queue a second message while the first runs, steer a running reply.

## Expected result

The shared agent shows for the group only; the approval card appears before the draft is made.

## If it breaks, look here

- Agent sharing: admin panel permissions for agents
- Approval rules: `endpoints.agents.toolApproval` in the yaml (on v0.8.8, read tools may also ask; see `runbooks/update.md`)
- Beta features (handoffs, subagents) are not part of the go-live tests
