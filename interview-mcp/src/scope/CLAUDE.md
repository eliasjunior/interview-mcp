# interview-mcp/src/scope — Context

Single file: `builder.ts`. Pure, side-effect-free functions that render the `customContent` markdown block used by `start_scoped_interview` (via `../tools/buildScope.ts`, the `build_scope` tool).

## `builder.ts`

- `buildScopeContent({ topic, focusAreas, weakSpots, depth, outOfScope, sessionGoal })` — assembles a `# Study Scope: <topic>` markdown document: Focus Areas → Depth (with a fixed description per `DEPTH_DESCRIPTION` key: `conceptual`, `implementation`, `trace-through-code`, `mixed`) → Evaluation Criteria (auto-generated one-per-focus-area via `buildCriterion`) → optional Known Weak Spots → optional Out of Scope → Session Goal.
- `deriveSessionGoal(topic, focusAreas, depth)` — default session-goal sentence when the caller doesn't supply one, listing up to 3 focus areas plus a "+N more" tail.

This is the **structured-input path** into a scoped/design interview — the caller supplies discrete fields (focus areas, weak spots, depth, etc.) and gets back ready-made markdown. Compare with `../scopedInterview/session.ts`, which takes free-form pasted content (spec/README/algorithm problem) and parses it instead.

## Conventions

- Keep this pure — no DB, no session creation. `build_scope` just returns the generated content string; it's `start_scoped_interview` (see `../scopedInterview/`) that turns content into a `Session`.
- If you add a new `depth` value, add its description to `DEPTH_DESCRIPTION` — an unknown depth silently falls back to the `mixed` description.
