# interview-mcp/src/evaluation — Context

Small, pure-function module. Currently a single file: `strongAnswer.ts`.

## `strongAnswer.ts`

`buildStrongAnswer({ criteria, feedback, answer })` derives the "stronger model answer" text shown on the back of an auto-generated flashcard (see the Flashcard System section of the root `interview-mcp/CLAUDE.md`). It never calls the AI provider — this is deterministic text derivation, tried in priority order:

1. **Explicit `Strong answer:` block in `evaluationCriteria`** — `extractExplicitStrongAnswer` regex-extracts it directly, stopping at a following `Bonus:`/`Weak answer:` marker.
2. **Derived from `evaluationCriteria`** — `criteriaToStrongAnswer` strips the `Question N:`/`Weak answer:`/`Bonus:` noise, then rewrites `Must include/mention/identify/define/describe/explain/compare X` sentences into imperative form (`Include X`, `Define X`, ...).
3. **Derived from interviewer feedback** — `feedbackToStrongAnswer`: if feedback already opens with a positive marker (`Strong answer`, `Excellent`, `Perfect`, `Solid answer`, `Good foundation`) and the candidate's own answer is available, the candidate's answer *is* the strong answer; otherwise returns `"A stronger answer would cover the missing points called out in feedback: ..."`.
4. **Fallback to the candidate's raw answer**, whitespace-collapsed.

Returns `undefined` only if all three inputs are empty.

## Callers

- `../tools/evaluateAnswer.ts` — computes the strong answer at evaluation time, stored with the evaluation record
- `../ai/anthropic.ts` — parked AI adapter path (see `../ai/CLAUDE.md` if it exists, or the "Frozen / Parked Code" section of the root `interview-mcp/CLAUDE.md`)
- `../db/backfillStrongAnswers.ts` — one-off script that fills in missing `strongAnswer` text on historical evaluations

## Conventions

- Keep this module pure and side-effect-free — no DB access, no AI calls. If evaluation logic needs either, it belongs in `../tools/evaluateAnswer.ts`, not here.
- Regex-based text derivation is intentionally simple/heuristic, not NLP. When it produces a bad result for a specific `evaluationCriteria` phrasing, prefer adding a new regex branch over introducing an AI call — this path exists specifically to avoid API cost (`AI_ENABLED=false` mode).
