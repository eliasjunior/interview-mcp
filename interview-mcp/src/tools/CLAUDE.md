# interview-mcp/src/tools — Context

One file per MCP tool. Each file exports a single `register<Name>Tool(server: McpServer, deps: ToolDeps)` function that calls `server.registerTool(name, { description, inputSchema }, handler)`. `registerAllTools.ts` imports every register function and calls them in sequence against the `McpServer` instance built in `server.ts`.

**36 tools currently registered.** Keep the count and tool list in the root `interview-mcp/CLAUDE.md` in sync if you add or remove one.

## `ToolDeps` (`deps.ts`)

Every tool receives the same `deps` object — the single dependency-injection seam for this folder. It bundles:
- `ai: AIProvider | null` — parked/deprecated (see `src/ai/`)
- `knowledge: KnowledgeStore` — reads topics/questions/concepts from SQLite
- session/flashcard/graph/mistake/skill/exercise load-and-save functions (backed by `src/repositories/` interfaces, implemented in `src/db/repositories/`)
- `assertState(session, toolName)` — the state-machine guard every mutating tool calls first
- `generateId`, `findLast`, `calcAvgScore`, `buildSummary`, `finalizeSession` — shared pure helpers

A tool file should never reach past `deps` into `src/db/` directly — new persistence needs go through `deps` (add a method to `ToolDeps` in `deps.ts`, implement it where `deps` is constructed in `server.ts`).

## Tool groups

### Core interview state machine
`ASK_QUESTION → WAIT_FOR_ANSWER → EVALUATE_ANSWER → FOLLOW_UP` (loops) `→ ENDED`. Each tool asserts the session is in the right state before acting.

| Tool | File | Notes |
|---|---|---|
| `start_interview` | `startInterview.ts` | Selects up to `maxQuestions` questions for a topic, creates the session |
| `ask_question` | `askQuestion.ts` | Presents current question; candidate-facing, never leaks `evaluationCriteria` |
| `submit_answer` | `submitAnswer.ts` | Valid in `WAIT_FOR_ANSWER` |
| `evaluate_answer` | `evaluateAnswer.ts` | **Largest tool file (566 lines).** Scores 1–5, decides whether a follow-up is needed. Holds most of the follow-up-question generation logic (adaptive challenge building, MCQ parsing, code-submission detection, problem-aware follow-ups) as private helpers above the register function |
| `ask_followup` | `askFollowup.ts` | Valid in `FOLLOW_UP` |
| `next_question` | `nextQuestion.ts` | Advances or ends the interview if questions are exhausted |
| `end_interview` | `endInterview.ts` | Force-end at any state; triggers flashcard generation via `finalizeSession` |
| `get_session` / `list_sessions` / `delete_session` | — | Session CRUD/read, `delete_session` also previews/cascades derived artifacts (flashcards, graph nodes, reports) |
| `server_status` / `help_tools` | — | Preflight check and self-describing tool listing |

### Interview mode variants
See also [`../scope/`, `../scopedInterview/`, `../drills/` CLAUDE.md](../scope/CLAUDE.md) for the modules these tools delegate to.

| Tool | File | Notes |
|---|---|---|
| `start_scoped_interview` | `startScopedInterview.ts` | Interview grounded in user-supplied content (spec/README); no AI call for question generation |
| `build_scope` | `buildScope.ts` | Builds the `content` block for `start_scoped_interview` from structured inputs |
| `start_drill` | `startDrill.ts` | Targeted drill on weak spots from the most recent completed session for a topic |
| `start_warm_up` | `startWarmUp.ts` | **399 lines.** MCQ warm-up session; `selectWarmupQuestions`/`orderWarmupQuestions` weight by `warmup_history` correct/incorrect counts, `normaliseAnswerPattern`/`answerCardinality` classify answer shape |
| `get_topic_level` | `getTopicLevel.ts` | **557 lines, second-largest file.** `detectTopicLevel` computes recommended level (0–4) from session history; `buildSessionRewardSummary` builds the post-session reward copy shown to the candidate |
| `practice_micro_skill` | `practiceMicroSkill.ts` | Focused drill on one skill/sub-skill from the skill backlog |

### Code-interview / algorithm tools
See [`../codeChallenges/`, `../codeExecution/` CLAUDE.md](../codeChallenges/CLAUDE.md).

| Tool | File | Notes |
|---|---|---|
| `configure_code_challenge` | `configureCodeChallenge.ts` | Attaches an executable challenge (with private tests) to an existing code-interview session |
| `run_code` | `runCode.ts` | Compiles/runs candidate code against the attached private tests |
| `log_algorithm_problem` | `logAlgorithmProblem.ts` | Required after `end_interview` on any `interviewType: "code"` session — enforced by a hint in the `end_interview` response, not by the server |

### Flashcards / SRS
See `srsUtils.ts` (SM-2 algorithm) documented in the root `interview-mcp/CLAUDE.md`.

| Tool | File | Notes |
|---|---|---|
| `get_due_flashcards` | `getDueFlashcards.ts` | `dueDate <= now`, most-overdue first |
| `review_flashcard` | `reviewFlashcard.ts` | Applies SM-2 for a rating 1–4 |
| `create_flashcard` | `createFlashcard.ts` | Direct creation from supplied content (not the automatic post-interview path) |
| `prepare_flashcards` | `prepareFlashcards.ts` | Builds ready-to-submit `create_flashcard` payloads for weak answers in a completed interview |
| `generate_flashcard_variation` | `generateFlashcardVariation.ts` | Rewords a flashcard question to avoid rote memorisation |
| `evaluate_flashcard` | `evaluateFlashcard.ts` | Scans `Pending` flashcard answers, marks `Evaluating`, returns batched context — does **not** finalize by itself |
| `save_flashcard_evaluation` | `saveFlashcardEvaluation.ts` | Finalizes one evaluated answer; on weak recall archives the old card and creates a linked replacement + mistake |

`evaluate_flashcard` and `save_flashcard_evaluation` are a two-step pair — a caller that stops after `evaluate_flashcard` leaves answers stuck in `Evaluating` with no replacement card created.

### Mistakes / skills / exercises / topics

| Tool | File | Notes |
|---|---|---|
| `log_mistake` / `list_mistakes` | — | Mistake log, optionally filtered by topic |
| `add_skill` / `list_skills` / `update_skill` | — | Skill backlog CRUD (confidence 1–5 scale) |
| `create_exercise` / `list_exercises` | — | Structured coding exercises; `create_exercise` also runs a `tooHard` complexity check and writes a `.md` file to the knowledge center |
| `list_topics` | — | Topics with curated knowledge files (pre-built questions, no AI call) |

## Conventions when adding a tool

1. New file `<toolName>.ts` exporting `register<ToolName>Tool(server, deps)`.
2. Input validated with a Zod schema passed as `inputSchema` to `registerTool`.
3. Mutating tools call `deps.assertState(session, "<tool_name>")` first and return `deps.stateError(...)` on failure.
4. Register the new function in `registerAllTools.ts` (import + call, in the same relative order as the state machine/feature it belongs to).
5. If the tool needs new persistence, extend `ToolDeps` in `deps.ts` rather than importing `src/db/` directly.
