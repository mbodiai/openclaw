---
name: granola
description: Search and query Granola meeting notes, transcripts, and action items via the Granola MCP server. Use when the user asks about meetings, meeting notes, action items, decisions, attendees, what was discussed, follow-ups, or anything related to their meeting history.
---

# Granola MCP

Query Granola meeting data via mcporter + mcp-remote (Streamable HTTP + OAuth 2.0).

Server: `granola` (configured in mcporter, proxied via `npx mcp-remote`)

## Setup (once)

```bash
mcporter config add granola --stdio "npx -y mcp-remote https://mcp.granola.ai/mcp"
# Auth: run once, completes via browser OAuth (Google SSO)
npx -y mcp-remote https://mcp.granola.ai/mcp
# Token is cached locally after first auth.
```

Verify: `mcporter list granola --schema`

## Tools

| Tool                     | Use when                                                                        | Key params                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `query_granola_meetings` | Open-ended questions about meeting content, action items, decisions, follow-ups | `query` (string), optional `document_ids` (UUID[])                                               |
| `list_meetings`          | Listing meetings in a time range, getting meeting IDs                           | `time_range` (this_week/last_week/last_30_days/custom), `custom_start`, `custom_end` (ISO dates) |
| `get_meetings`           | Detailed info for specific meetings (notes, summary, attendees)                 | `meeting_ids` (UUID[], max 10)                                                                   |
| `get_meeting_transcript` | Exact quotes or verbatim transcript                                             | `meeting_id` (UUID)                                                                              |

**Prefer `query_granola_meetings`** for most questions — it does natural-language search across all meetings and returns inline citation links. Use `list_meetings` → `get_meetings` when you need to browse by date or drill into specific meetings.

## Usage

```bash
# Natural-language query (preferred for most questions)
mcporter call granola.query_granola_meetings query="What action items came out of last week's meetings?"

# List this week's meetings
mcporter call granola.list_meetings time_range=this_week

# List meetings in a custom range
mcporter call granola.list_meetings time_range=custom custom_start=2026-02-01 custom_end=2026-02-28

# Get detailed meeting info by ID
mcporter call granola.get_meetings --args '{"meeting_ids":["<uuid>"]}'

# Get raw transcript
mcporter call granola.get_meeting_transcript meeting_id=<uuid>
```

## Important

- **Citations:** `query_granola_meetings` returns numbered citation links (e.g. `[[0]](url)`). Always preserve these in your response.
- Only meetings where the user is the **owner** are queryable.
- Free plan: last 30 days only. Transcripts: paid tiers only.
- Rate limit: ~100 req/min across all tools.
