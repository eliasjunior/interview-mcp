# Mock Interview MCP — Project Context

## Highest Priority Rule

In every new Desktop app thread in this project, the first response must be an MCP connection check.

Before answering the user's request, first state whether `interview-mcp` is connected in the current Desktop session.

- If it is not connected, say: `Before I continue, I should check whether interview-mcp is connected in this Desktop session. It is not connected, should I stop here or continue ?`
- Do not answer the user's actual request until this check has been reported.

## MCP Connection Troubleshooting

If `interview-mcp` fails to connect:

```bash
tail -n 50 ~/Library/Logs/Claude/mcp-server-interview-mcp.log
```

| Symptom in log | Cause | Fix |
|---|---|---|
| `Cannot find module '.../dist/server.js'` | Project not built | Run `npm run build` from repo root |
| `Server transport closed unexpectedly` | Process crashed on startup | Check for syntax errors or missing `.env` |
| `Missing environment variables` | `.env` not loaded | Verify `interview-mcp/.env` has `AI_ENABLED` set |

After fixing: run `npm run build`, fully quit and reopen Claude Desktop, confirm with `server_status`.

## Overview

Mock technical interview platform — interviews driven through MCP tools, AI-assisted evaluation, knowledge graph growth across sessions, spaced repetition flashcards, and a React dashboard.

**npm workspaces monorepo** with four packages:

| Package | Description |
|---|---|
| `interview-mcp` | MCP server — interview state machine, session data owner, REST API on port 3001 |
| `report-mcp` | MCP server — analytics and reporting on completed sessions, HTML report viewer |
| `ui` | React + Vite dashboard — sessions list, tabbed report viewer, D3 knowledge graph, learner progress |
| `shared` | TypeScript types only — single source of truth, imported at compile time only |

## Architecture

```
Claude Desktop / Claude Code (orchestrator LLM)
    │  stdio (MCP)
    ├──► interview-mcp (state machine, data owner)
    └──► report-mcp (read-mostly, analytics)
              │
         interview-mcp/data/  (shared runtime DB: app.db, plus reports/)
              │
         interview-mcp HTTP :3001
              │ fetch /api/*
         ui :5173  (React dashboard)
```

## Dev Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the full dev stack (HTTP API + UI) via `concurrently`. Preferred day-to-day command. |
| `npm run dev:http` | Start only the `interview-mcp` HTTP API on port 3001. |
| `npm run dev:ui` | Start only the `ui` Vite dev server on port 5173. |
| `npm run build` | Build all packages |

Both `dev:http` and `dev:ui` bind to `0.0.0.0` — reachable from any device on the local network.

## Modes

- `AI_ENABLED=false` (default) — questions from knowledge files, orchestrator evaluates using `evaluationCriteria`, no API cost
- `AI_ENABLED=true` — full AI: question generation, scoring, concept extraction, deeper dives via Anthropic API (haiku model)

## Important Conventions

- **Shared types only in `shared/src/types.ts`** — never add a local `types.ts` to a package
- **Do not set `ANTHROPIC_API_KEY` in `.mcp.json` env block** — it overrides dotenv with an empty string
- Worker LLM model: `claude-haiku-4-5-20251001`
- Storage: shared SQLite at `interview-mcp/data/app.db` plus report/public artifacts on disk
- **Flashcard generation is automatic** — triggered by `end_interview`, no manual step needed
- **SM-2 logic lives only in `srsUtils.ts`** — never duplicate scheduling logic in tools or HTTP handlers

## Development Notes

- Keep it simple and iterative — learning project, not production-grade
- MCP concepts explored: typed tool schemas (Zod), session state machine, microservice-style MCP split, npm workspaces, spaced repetition scheduling, scheduled tasks

## Knowledge Storage for the design and code questions

Topics, questions, concepts, and warm-up MCQs live in SQLite. The relevant tables are: `topics`, `topic_questions`, `topic_concepts`, `warmup_questions`, `warmup_history`, `algorithm_problems`. To add or update topic content, edit the DB directly.

## Package-specific context

Each package has its own `CLAUDE.md` with deeper context — Claude loads it automatically when you work in that directory:

- [`interview-mcp/CLAUDE.md`](interview-mcp/CLAUDE.md) — interview rules, tools, flashcard system, knowledge file format, drill/scoped/algorithm tools
- [`ui/CLAUDE.md`](ui/CLAUDE.md) — Crisis Mode, FlashcardsPage, session badges
- [`report-mcp/CLAUDE.md`](report-mcp/CLAUDE.md) — report tools
- [`shared/CLAUDE.md`](shared/CLAUDE.md) — domain types reference
