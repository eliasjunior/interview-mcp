# interview-mcp/src/db — Context

Drizzle ORM + `better-sqlite3` against the shared runtime database at `interview-mcp/data/app.db`. This is the **only** package that owns write access to `app.db` — `report-mcp` and the `ui` only read it (via HTTP or direct SQLite read in report-mcp).

## Ports and adapters — this is NOT duplicated code

Repository access is split across two folders on purpose:

- **`../repositories/`** — pure TypeScript **interfaces** (ports). No DB imports. `AppRepositories` aggregates them (`sessions`, `flashcards`, `flashcardAnswers`, `graph`, `mistakes`, `skills`, `exercises`, `topicPlans`, `codeChallenges`, `algorithmProblems`). Also holds `mappers.ts` — row ↔ domain-type conversion shared by the SQLite implementations.
- **`db/repositories/`** (this folder) — the SQLite **implementations** (`SQLite<Name>Repository` classes), one per interface, plus `createRepositories.ts` which wires them into a concrete `AppRepositories` via `createSqliteRepositories(db)`.

Tool code (`../tools/`) depends on `ToolDeps`, which is backed by `AppRepositories` — it should never import `db/repositories/*` directly, only the interfaces in `../repositories/`.

If you add a new entity: define the interface in `../repositories/<name>Repository.ts`, add it to `AppRepositories` in `../repositories/index.ts`, implement `SQLite<Name>Repository` here, wire it in `createRepositories.ts`.

## Files

| File | Purpose |
|---|---|
| `schema.ts` | Drizzle table definitions + relations. Single source of truth for DB structure — 25 tables covering sessions, flashcards, graph, skills, exercises, mistakes, code challenges, algorithm problems, plus the content tables (`topics`, `topic_questions`, `topic_concepts`, `warmup_questions`, `warmup_history`) |
| `client.ts` | `createDb()` — opens `better-sqlite3` at `DATABASE_URL` env var or `data/app.db`, sets WAL mode + foreign keys, wraps in `drizzle()`. `AppDb` type is the shape every repository takes in its constructor |
| `migrate.ts` | Runs pending migrations from `interview-mcp/drizzle/` against the resolved DB path — `npm run db:migrate` |
| `backup.ts` | Live `.backup()` snapshot to `data/backups/app.<timestamp>.backup.db`, prunes to `DB_BACKUP_KEEP` (default 10) — `npm run db:backup` |
| `repositories/` | SQLite adapters — see above |

## One-off scripts (`npm run db:*`)

These are maintenance/migration scripts, not part of the runtime server. Each opens its own `createDb()` instance and repository set — run them standalone, not imported elsewhere.

| Script | Command | What it does |
|---|---|---|
| `importJsonData.ts` | `db:import-json` | One-time import of the pre-SQLite legacy JSON session store (`data/legacy-json/` if present) via `../import/legacyJson.ts` |
| `backfillStrongAnswers.ts` | `db:backfill-strong-answers` | Fills missing `strongAnswer` text on old evaluations using `../evaluation/strongAnswer.ts` |
| `backfillFlashcards.ts` | `db:backfill-flashcards` | Generates flashcards for `ENDED` sessions that predate automatic flashcard generation |
| `rescheduleFlashcards.ts` | `db:reschedule-flashcards` | Staggers all currently-due flashcards (topics 3 days apart, cards within a topic 1 day apart) without touching `easeFactor`/`repetitions` — use when a due pile has built up and needs spreading out, not a real SRS state change |
| `rebuildGraph.ts` | `db:rebuild-graph` | Recomputes the entire knowledge graph from scratch by replaying `mergeConceptsIntoGraph` over every session's stored concepts |

`db:generate` and `db:studio` are `drizzle-kit` commands (generate migration files from `schema.ts`, open the Drizzle Studio browser) — not scripts in this folder.

## Conventions

- Never write raw SQL against `app.db` outside this folder — go through a repository.
- Schema changes: edit `schema.ts`, run `npm run db:generate` to produce a migration in `interview-mcp/drizzle/`, then `npm run db:migrate`.
- `mappers.ts` (in `../repositories/`) is where row-shape drift between `schema.ts` and the domain types in `@mock-interview/shared` gets absorbed — keep that logic there, not duplicated inside individual `SQLite*Repository` classes.
