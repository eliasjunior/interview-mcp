# interview-mcp/src/drills — Context

Single file: `contentBuilder.ts`. Pure functions that turn one past interview session's weak evaluations and logged mistakes into drill session content, used by `../tools/startDrill.ts` (`start_drill` tool).

## `contentBuilder.ts`

- `buildDrillCustomContent(topic, sourceId, sourceDate, avgScore, weakEvals, mistakes)` — renders the `customContent` markdown stored on the new drill session: header with source session id/date/avg score, then one `### Question N` block per weak evaluation (score < 4) showing the original question, previous feedback, and `strongAnswer` if one was recorded, followed by a `## Known Mistake Patterns` section listing each mistake's pattern and fix. This is what `evaluate_answer` reads as the rubric for the drill.
- `buildRecallContext(weakEvals, mistakes)` — builds the `RecallContext` object (`knownMistakes[]`, `weakAreas[]`) returned to the orchestrator so it can run a recall step with the candidate *before* asking the first drill question.

## Where the inputs come from

`../tools/startDrill.ts` does the actual selection logic (most recent `ENDED` session for the topic, evaluations with `score < 4`, mistakes for the topic) and calls into these two builders — this folder has no DB or session access itself.

## Conventions

- Keep pure — no I/O. Selection/filtering logic (which session, which evaluations count as "weak") belongs in the tool, not here.
- If you change `buildDrillCustomContent`'s markdown shape, verify `evaluate_answer` still parses/uses it as expected — it's read as free-form rubric context, not structured data.
