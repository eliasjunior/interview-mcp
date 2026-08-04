# interview-mcp/src/exercises — Context

Two pure files backing the `create_exercise` / `list_exercises` tools (`../tools/createExercise.ts`, `../tools/listExercises.ts`). See also the "Exercise System" section of the root `interview-mcp/CLAUDE.md` for the difficulty scale and tool-level flow.

## `assessment.ts`

`assessComplexity(difficulty, prerequisites, existingExercises)` decides whether an exercise is appropriate to hand to the candidate right now:

- `tooHard = true` when `difficulty >= 4` **or** any named prerequisite doesn't yet exist in `existingExercises`.
- `roadmap` — the unmet-and-met prerequisites resolved against `existingExercises`, sorted by difficulty ascending, so the orchestrator can propose a clear progression instead of just rejecting the request.
- `reason` — human-readable explanation (`"Prerequisites not yet created: X, Y"` or `"Difficulty N/5 — recommend completing prerequisites first"`), `null` when not too hard.

## `markdown.ts`

`buildExerciseMarkdown(exercise, opts)` renders a full `Exercise` record — plus caller-supplied `learningGoal`, `problemStatement`, `steps`, `evaluationCriteria`, `hints`, `relatedConcepts` — into the `.md` file `create_exercise` writes to `data/knowledge/exercises/<topic>/<slug>.md`. `DIFFICULTY_LABELS` maps 1–5 to `Trivial`…`Very Hard` and is also the canonical label set for difficulty display elsewhere (e.g. `list_exercises` output).

## Conventions

- Both files are pure — no DB, no filesystem access. `create_exercise` (the tool) is responsible for persisting the returned markdown string and the `Exercise` metadata.
- If you change the difficulty→`tooHard` threshold or the label set, keep `assessment.ts` and `markdown.ts` consistent — `DIFFICULTY_LABELS` in `markdown.ts` should cover every difficulty value `assessComplexity` can accept (1–5).
