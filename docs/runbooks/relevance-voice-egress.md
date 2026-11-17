# Relevance AI, ElevenLabs and egress

## Pieces

| Container | Holds | Talks to |
| --- | --- | --- |
| `mcp-relevance` | Relevance AI API key, `mcp-config/relevance-agents.json` | `api-<region>.stack.tryrelevance.com`, `auditdb` |
| `mcp-voice` | ElevenLabs API key, `mcp-config/voice-agents.json` | `api.elevenlabs.io`, `auditdb` |
| `api` (LibreChat) | ElevenLabs key for read-aloud, OpenAI key for dictation | `api.elevenlabs.io`, `api.openai.com` |

Both gateways are outbound only. The vendors' own MCP servers expose 40+ tools (creating agents, placing calls, changing voices); the gateways expose only the tools below, and only for agents on the allowlist.

## Tools

| Server | Tool | Who | Approval |
| --- | --- | --- | --- |
| relevance | `agents_list` | anyone with a role on at least one listed agent | allowed |
| relevance | `agent_run` | the agent's `roles` | **ask**, recorded |
| relevance | `agent_result` | the person who started the run, for 24 hours | allowed |
| voice | `voice_agents_list` | the agent's `roles` | allowed |
| voice | `conversations_list` | the agent's `roles` (default: last 24 hours, all your agents) | allowed |
| voice | `conversation_get` | the agent's `roles`; transcript and analysis only, no audio or cost | allowed |
| voice | `start_call` | the agent's `callRoles`; only exists when a phone number id is set | **ask**, recorded |

`agent_run` is asked and recorded because it sends company data to Relevance and the agent may act on it.

## Add an agent

Agent ids come from the Relevance agent page URL or from ElevenLabs (Agents, then the agent's settings).

```json
{
  "agents": [
    {
      "id": "8c1f...",
      "name": "Quote follow-up",
      "description": "Chases open quotes and drafts a status for each",
      "roles": ["LibreChat.User"]
    }
  ]
}
```

`voice-agents.json` takes the same fields plus `callRoles` (default none: nobody can start calls with that agent). Roles are the app roles on PressRoom-MCP. Then:

```bash
docker compose up -d mcp-relevance mcp-voice   # the files are read at start
```

An invalid file (missing roles, duplicate ids) stops the container; `docker compose logs mcp-relevance` says why.

## Keys and settings

| SSM parameter | Used for |
| --- | --- |
| `/pressroom/secrets/relevance-api-key` | Relevance API key (Integrations & API Keys, Admin role) |
| `/pressroom/config/relevance-region`, `relevance-project-id` | From the same page; the API host is `api-<region>.stack.tryrelevance.com` |
| `/pressroom/secrets/elevenlabs-api-key` | Gateway and read-aloud |
| `/pressroom/config/elevenlabs-voice-id` | Read-aloud voice |
| `/pressroom/config/elevenlabs-phone-number-id` | Optional; without it `start_call` does not exist |

Rotate: `ROTATE_PROVIDER_KEYS=1 npm run secrets`, then `bin/render-env.sh` and `docker compose up -d`. With the old key gone the gateways answer "refused the server's API key" and nothing else happens (fails closed).

## Read-aloud and dictation

`speech:` in `librechat.yaml`: read-aloud uses ElevenLabs (`eleven_multilingual_v2`, max 4000 characters per request since every 1000 characters is billed), dictation uses OpenAI `whisper-1`. LibreChat supports only OpenAI or Azure for speech to text. Both default to the server-side engine and do not auto-play or auto-send; people change that in Settings, Speech.

## Webhooks

Nothing calls into the server. Agent results are polled (`agent_result`) and call transcripts are read on demand. If the client later wants Relevance or ElevenLabs post-call webhooks, the plan is an API Gateway to SQS relay that the gateways poll; it is not built (decisions.md #13).

## Egress

The VPC's DNS Firewall allows only the names in `infra/lib/dns-firewall.ts` and answers NXDOMAIN for everything else. Prove it from inside the containers:

```bash
npm run egress:check     # from the laptop, via SSM
sudo /opt/pressroom/server/bin/egress-check.sh   # on the server
```

It resolves and calls each approved provider from `api`, `mcp-relevance` and `mcp-voice`, and expects other AI APIs (Mistral, Gemini, Cohere, DeepSeek, Groq) and `example.com` to fail at DNS.

## Checks (Phase 5 done when)

| Check | Expected |
| --- | --- |
| alice: "ask the quote follow-up agent which Acme quotes are open, then summarise" | Approval card for `agent_run`; then `agent_result` until complete; a summary; one `triggered` row in `approved_actions` |
| bob runs an agent listed only for `Pace.Estimating` | Not permitted, logged |
| alice: "summarise yesterday's calls to reception" | `conversations_list` with yesterday's window, then `conversation_get` for the ones that matter |
| Read-aloud on a reply | Plays in the ElevenLabs voice |
| `npm run egress:check` | All PASS, `api.mistral.ai` blocked |
