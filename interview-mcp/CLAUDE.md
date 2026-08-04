# interview-mcp — Context

## Interview Behavior Rules

- In live interview mode, the candidate should see only the interview question and neutral next-step instructions.
- `evaluationCriteria`, rubrics, expected-answer structure, scoring hints, and similar fields are evaluator-only context.
- Never reveal evaluator-only context to the candidate, even if a tool payload includes it alongside the question.
- When `AI_ENABLED=false`, the orchestrator may use `evaluationCriteria` to score the answer, but it must keep that rubric hidden while asking the question.
- The interview flow should remain: ask the question, wait for the candidate's answer, evaluate, then continue. Do not front-load the grading rubric into the candidate prompt.

### Warm-up MCQ Presentation Rule

**STRICT RULE — no exceptions.**

For warm-up sessions (Spark / Padawan levels), questions are authored MCQs served from the `warmup_questions` table. Present every warm-up MCQ **exactly as returned by the tool** — question stem and all answer choices verbatim.

- **Do NOT add any scene-setting sentences, scenarios, or framing before the question.** Not one sentence, not a phrase. Nothing.
- **Do NOT reframe, paraphrase, or expand the question stem in any way.**
- The only allowed prefix is the question number (e.g. "Question 2 of 5").
- Present the question stem and choices exactly as they appear in the file, then wait for the answer.

Reframing or adding context changes intent, difficulty, and which choices are correct. The candidate should see the file text and nothing more. This rule overrides any general heuristic about problem-first framing or scene-setting.

## Key Files & Paths

```
interview-mcp/
├── src/
│   ├── server.ts               # MCP bootstrap, registers 36 tools
│   ├── http.ts                 # Express REST API port 3001
│   ├── tools/                  # One file per MCP tool
│   ├── ai/                     # DEPRECATED, not using anymore - AIProvider port + Anthropic adapter (haiku model)
│   ├── knowledge/              # DbKnowledgeStore — reads topics/questions/concepts from SQLite
│   ├── interviewUtils.ts       # Pure utils: state guards, report builder, graph merge, flashcard generator
│   └── srsUtils.ts             # SM-2 spaced repetition algorithm (pure, side-effect-free)
├── data/
│   ├── app.db                  # Shared runtime database (sessions, graph, flashcards, algorithm, knowledge tables)
│   └── reports/                # One .md report per completed session
└── .env                        # NOT USING ANYMORE - ANTHROPIC_API_KEY, AI_ENABLED
```

### Knowledge tables (in `app.db`)

| Table | Contents |
|---|---|
| `topics` | One row per topic (slug, title, summary) |
| `topic_questions` | Interview questions per topic with difficulty and evaluation criteria |
| `topic_concepts` | Concept clusters per topic (core concepts, tradeoffs, etc.) |
| `warmup_questions` | MCQ warm-up questions per topic/level |
| `warmup_history` | Per-question correct/incorrect history for weighted selection |
| `algorithm_problems` | Algorithm problems tracker record |

To add or edit topic content: update the Markdown source under `data/knowledge/` then re-run the seed script to sync the DB.

## State Machine & Tools

Session states: `ASK_QUESTION → WAIT_FOR_ANSWER → EVALUATE_ANSWER → FOLLOW_UP` (loops), then `ENDED`.

**36 MCP tools:** `server_status`, `help_tools`, `start_interview`, `start_scoped_interview`, `ask_question`, `submit_answer`, `evaluate_answer`, `ask_followup`, `next_question`, `end_interview`, `get_session`, `list_sessions`, `list_topics`, `get_due_flashcards`, `prepare_flashcards`, `create_flashcard`, `review_flashcard`, `log_mistake`, `list_mistakes`, `start_drill`, `add_skill`, `list_skills`, `update_skill`, `practice_micro_skill`, `create_exercise`, `list_exercises`, `build_scope`, `delete_session`, `generate_flashcard_variation`, `get_topic_level`, `start_warm_up`, `evaluate_flashcard`, `save_flashcard_evaluation`, `configure_code_challenge`, `run_code`, `log_algorithm_problem`

See [`src/tools/CLAUDE.md`](src/tools/CLAUDE.md) for the full breakdown by tool group.

**REST API (port 3001):**
- `GET /api/sessions` — all sessions
- `GET /api/reports` — report metadata list
- `GET /api/reports/:id` — single report markdown
- `GET /api/graph` — knowledge graph JSON
- `GET /api/flashcards` — all flashcards
- `POST /api/flashcards/:id/review` — submit a review rating `{ rating: 1|2|3|4 }`, applies SM-2, returns updated card
- `POST /api/flashcards/:id/answers` — store an optional non-empty raw candidate answer for later evaluation
- `GET /api/mistakes` — all logged mistakes (optional `?topic=` filter)
- `GET /generated/report-ui.html` — HTML report viewer

## Flashcard System

### What it does

After an interview ends (`end_interview` tool), the system automatically generates flashcards for every question where the candidate scored **below 4**. Cards are stored in `interview-mcp/data/app.db` and scheduled using the **SM-2 spaced repetition algorithm**.

Each card contains:
- **Front** — the original interview question
- **Back** — rich markdown: candidate's answer, interviewer feedback, stronger model answer, and deeper dive (if available)
- **SRS state** — `dueDate`, `interval` (days), `easeFactor`, `repetitions`, `lastReviewedAt`
- **Metadata** — `topic`, `difficulty` (easy/medium/hard mapped from score), `tags`, `source` (sessionId + questionIndex)
- **Lineage** — optional `parentFlashcardId` and `replacedByFlashcardId` so improved cards form a replacement chain instead of losing history

Cards are **idempotent**: re-running `end_interview` on the same session will not create duplicates (deduplication by `id = sessionId-questionIndex`).

### Flashcard Answer Evaluation Loop

- `flashcard_answers` stores the raw answer plus a `Pending -> Evaluating -> Completed` state machine
- the UI lets the learner type an answer on the front of the review card before revealing the back
- submitting a rating still performs the normal `review_flashcard` SM-2 update; if answer text exists, the UI also posts it asynchronously to `POST /api/flashcards/:id/answers`
- `evaluate_flashcard` claims pending answers, marks them `Evaluating`, and returns the context Claude needs: flashcard question, expected answer, and candidate answer
- Claude must then call `save_flashcard_evaluation` once per returned answer with the verdict
- Any scheduled or automated flashcard-evaluation workflow is incomplete if it runs only `evaluate_flashcard`; it must also execute `save_flashcard_evaluation` for every returned answer or those answers will remain unfinalized and no replacement/history chain will be persisted
- if the verdict is `needs_improvement`, the old card is archived, a stronger replacement card is created with `parentFlashcardId`, the old card gets `replacedByFlashcardId`, and a linked mistake is logged

### SM-2 Algorithm (`srsUtils.ts`)

| Rating | Label  | Quality (SM-2) | Effect |
|--------|--------|----------------|--------|
| 1      | Again  | 0              | Reset: interval=1, repetitions=0, easeFactor−0.2 |
| 2      | Hard   | 2              | Passed but penalty: advance schedule, easeFactor−0.14 |
| 3      | Good   | 3              | Normal advance: 1→6→interval×easeFactor days |
| 4      | Easy   | 5              | Perfect: advance with easeFactor bonus |

`easeFactor` is clamped to a minimum of 1.3. All SM-2 logic is pure/side-effect-free in `srsUtils.ts`.

### MCP Tools (for Claude-driven review sessions)

**`get_due_flashcards`** — Returns all cards where `dueDate <= now`, sorted most-overdue first. Optional `topic` filter.

**`review_flashcard`** — Args: `cardId`, `rating` (1–4). Applies SM-2, updates `app.db`.

**`evaluate_flashcard`** — Scans for pending entries in `flashcard_answers`, marks them `Evaluating`, returns batched evaluation context. Does not by itself create replacement cards, archive old cards, log mistakes, or complete the workflow.

**`save_flashcard_evaluation`** — Marks the flashcard answer `Completed`. On weak recall, archives the old card, creates an improved replacement, and logs a fully linked mistake entry.

**Typical Claude review session flow:**
```
1. get_due_flashcards
2. [for each card] review_flashcard { cardId, rating }
3. evaluate_flashcard
4. [for each returned answer] save_flashcard_evaluation { ... }
```

If a scheduler or automation stops after step 3, flashcard improvement history will not be persisted.

### Scheduled Daily Reminder

A scheduled task (`flashcard-daily-review`) fires every day at **9:00 AM local time**:
- Calls `get_due_flashcards` via MCP
- Prints a summary table of due cards grouped by topic
- Links to `http://localhost:5173/flashcards` to open the UI review

## Knowledge Content Improvement Process

When the user asks to improve or update topic questions, changes go directly into the DB (`topics`, `topic_questions`, `topic_concepts`, `warmup_questions` tables in `app.db`).

### Goal
Every question should prepare the user for real senior-level interviews — build mental models, not test memorisation.

### Step 1 — Load and group by difficulty
Read the target Markdown file. Group questions into their difficulty tiers: `foundation`, `intermediate`, `advanced`. Present tier by tier.

### Step 2 — Analyse each tier with two lenses
1. **Interview frequency** — how often does this actually come up at senior level?
2. **Learning value** — does this build a transferable mental model, or just test recall?

Flag structural problems:

| Problem | Signal | Fix |
|---------|--------|-----|
| Definition-first framing | Starts with "What is X?" or "Explain X" | Reframe to "What problem does X solve?" or a concrete scenario |
| Bundled question | More than one `?` in the prompt | Split or focus on the most valuable ask |
| Laundry-list prompt | Lists things to explain ("Explain A, B, C, and D") | Replace with a colleague misconception or production failure |
| Wrong difficulty label | Design question requires knowledge from a harder tier | Relabel |
| Bad ordering | Question A requires concept B which appears later | Swap |
| Ambiguous scope | Could be answered at 3 different depths | Add a scenario or constraint to anchor depth |

### Step 3 — Present findings, wait for approval
Show a table of flagged questions with issue and proposed fix. Do not make changes yet.

### Step 4 — Apply approved changes
Update the relevant DB tables directly (`topic_questions`, `topic_concepts`), keeping question text, difficulty, and evaluation criteria in sync.

### Rewriting principles
- **Problem before solution**: scenario beats definition
- **One clear ask per question**: if a question has two `?`, keep the more valuable one
- **Evaluation criteria must match**: if the question now leads with a scenario, the criteria must score whether the candidate identified the problem

### What not to change
- Do not change questions the user marks as `keep`
- Do not reorder difficulty tiers
- Do not touch `## Concepts`, `## Summary`, or `## Warm-up Quests` unless explicitly asked

## Interview Types

### `InterviewType`

```typescript
export type InterviewType = 'design' | 'code'
// Session.interviewType?: InterviewType   (absent on legacy sessions → treated as 'design')
```

### Available design topics

Topics are stored in the `topics` table in `app.db`. Use `list_topics` to get the current list at runtime. Markdown sources live under `data/knowledge/design-interview/` and are the canonical authoring source.

### Concept cluster names

When seeding concepts, cluster names must be one of: `core concepts`, `practical usage`, `tradeoffs`, `best practices`.

## Frozen / Parked Code

### `AnthropicAIProvider` (`interview-mcp/src/ai/anthropic.ts`)

**Do not modify this file.** The `AIProvider` interface (`port.ts`) and its adapters (`anthropic.ts`, `cache.ts`) are stable and parked. They cover exactly four operations: `generateQuestions`, `evaluateAnswer`, `extractConcepts`, `generateDeeperDives`.

**New tools must not add methods to `AIProvider`.** If a new tool needs AI-style logic, that logic must live entirely inside the tool file itself. See `startScopedInterview.ts` as the reference pattern.

## Skill Backlog

Tracks transferable micro-skills — atomic abilities that appear across multiple problems (e.g. "2D index transformations" applies to rotate matrix, spiral matrix, transpose, pathfinding grids).

### Tools

| Tool | Description |
|---|---|
| `add_skill` | Add a skill with sub-skills, related problems, and initial confidence |
| `list_skills` | List backlog, optionally filtered by `maxConfidence` |
| `update_skill` | Update confidence after a drill — sub-skill or overall |
| `practice_micro_skill` | Start a focused micro-skill drill (5-step loop) |

### `practice_micro_skill` flow

```
practice_micro_skill { skill: "2D index transformations", subSkill: "layer boundaries" }
  → recall step: show recallQuestions + known mistakes to candidate
  → wait for recall response
  → ask_question → submit_answer → evaluate_answer → end_interview
  → flashcard auto-generated
  → update_skill { name, subSkill, confidence }
```

### Confidence scale

| Score | Meaning |
|---|---|
| 1 | Just identified — can't explain it |
| 2 | Partial recall — gaps under pressure |
| 3 | Can explain with prompting |
| 4 | Solid — can derive from first principles |
| 5 | Automatic — applies it without thinking |

## Exercise System

Structured coding exercises tied to knowledge topics — hands-on implementation tasks where the candidate writes actual code.

### Tools

| Tool | Description |
|---|---|
| `create_exercise` | Create a structured exercise, write `.md` to knowledge center, persist metadata, return complexity assessment + roadmap |
| `list_exercises` | List all exercises, optionally filtered by `topic` or `maxDifficulty` |

### `create_exercise` — what the tool does

1. Writes a rich `.md` file to `data/knowledge/exercises/<topic>/<slug>.md`
2. Persists metadata to SQLite
3. Runs a complexity assessment: `tooHard = true` if `difficulty >= 4` or any named prerequisite does not yet exist in the DB
4. Returns an `instruction` block telling the orchestrator what to do next

### Difficulty scale

| Score | Label     | `tooHard`? |
|-------|-----------|-----------|
| 1     | Trivial   | No        |
| 2     | Easy      | No        |
| 3     | Medium    | No        |
| 4     | Hard      | Yes       |
| 5     | Very Hard | Yes       |

### Knowledge file coverage → suggested exercises

| Topic | Exercises |
|---|---|
| `java-concurrency` | RaceConditionLab (Easy), ProducerConsumerBlockingQueue (Medium), ThreadPoolExecutorCustom (Hard) |
| `jwt` | JwtSignVerify (Easy), JwtExpiry (Easy), JwtRoleGuard (Medium) |
| `rest-spring-jpa` | CrudEndpoint (Easy), PaginatedEndpoint (Medium), OptimisticLockingRetry (Hard) |
| `payment-api-design` | IdempotencyKeyStore (Medium), PaymentStateMachine (Medium) |
| `url-shortener` | InMemoryShortener (Easy), ShortenerWithTTL (Medium), ShortenerLoadSim (Hard) |

## Drill Tool (`start_drill`)

Starts a targeted drill on weak spots from a past interview.

**Requirements:** at least one completed `ENDED` session for the topic.

**What it does:**
1. Finds the most recent completed session for the topic
2. Extracts evaluations where `score < 4`
3. Loads logged mistakes for the topic
4. Builds `recallContext` — returned to the orchestrator to run the recall step
5. Creates a new session tagged `sessionKind: "drill"`

**Edge cases:**
- No completed sessions → error: `"Complete a full interview first"`
- All questions scored ≥ 4 and no logged mistakes → `status: "no_weak_spots"`, suggest a new full interview

## Scoped Interview Tool (`start_scoped_interview`)

Starts an interview from user-provided content (project spec, README, architecture doc). Questions are generated locally by parsing the content — no AI provider calls during question generation.

```
start_scoped_interview {
  topic: "Mortgage API",
  content: "...full spec text...",
  focus: "robustness, reliability, and extensibility in a production environment"
}
```

## Algorithm Practice

### After a code interview ends

When `end_interview` is called on a session with `interviewType: "code"`, the response includes `algorithmTracker: { required: true }`. The orchestrator **must** call `log_algorithm_problem` before closing the session — this is enforced by the hint in the tool response, not automatically by the server.

### Path A — Current approach (supported today)

Use `start_scoped_interview` with a hand-crafted problem as `content`.

**Format for `content`:**
```
# Problem: Binary Search
## Problem Statement
## Constraints
## Expected approach
- Pattern: binary search
- Time: O(log n), Space: O(1)
## Common mistakes
```

### Path B — Future: proper algorithm support (parked)

When algorithm practice becomes a primary use case:
1. Add algorithm knowledge files (`binary-search.md`, `two-pointers.md`, etc.)
2. Activate `interviewType: "code"`
3. Add a `practice_pattern` tool for single-pattern drills
