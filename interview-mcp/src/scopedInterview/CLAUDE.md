# interview-mcp/src/scopedInterview — Context

Single file: `session.ts`, exporting `createScopedInterviewSession(...)`. This is the core logic behind the `start_scoped_interview` tool (`../tools/startScopedInterview.ts`) — turns free-form pasted content (a spec, README, architecture doc, or a hand-crafted algorithm problem) into a ready-to-run `Session`, with **no AI provider call**.

## Content-type detection

`inferScopedContentType(rawContent, problemTitle, interviewType)` decides `"algorithm"` vs `"api"`, in priority order:
1. Explicit `interviewType` arg if the caller passed one (`"code"` → algorithm, otherwise → api)
2. A non-empty `problemTitle` implies algorithm
3. `detectContentType` (from `../content/analyzer.ts`) — only trusted when it says `"algorithm"`
4. Default: `"api"` (design-interview path)

`looksLikeApiSpec` is a secondary heuristic (unused directly in the main flow but kept for reference/tests) requiring real HTTP endpoints, or both models and rules, to avoid false-positives from algorithm problems whose text happens to match the field extractor.

## Two build paths

**Algorithm path** (`buildAlgorithmScope`) — if the raw content doesn't already look like a scope doc (no `# Study Scope:` / `## Problem Statement` heading), synthesizes a full study-scope markdown around it: fixed Focus Areas (pattern recognition, invariants, edge cases, complexity, implementation), fixed Evaluation Criteria, fixed Known Weak Spots, an **Interviewer Guidance** section marked "do not reveal to candidate", and `## Common Interview Follow-Ups` built from `buildAlgorithmFollowUpCandidates` (`../content/questionBuilder.ts`). Ends with the original problem statement appended verbatim.

**API/design path** — delegates to `../content/parser.ts` (`extractSpec`) and `../content/analyzer.ts` (`detectGaps`) to pull endpoints/models/rules out of the pasted content, then `../content/questionBuilder.ts` (`polishContent`, `buildQuestions`) to generate the actual interview questions.

## `createScopedInterviewSession(...)`

Builds and returns `{ session, source, parsed, totalQuestions, previewQuestions, normalizedContent, detectedContentType, focusArea }`. The `Session` it constructs sets `interviewType: "code"` for the algorithm path or `"design"` otherwise, `sessionKind: "interview"`, starts in `ASK_QUESTION` state, and stores the normalized/polished content as `customContent` — this is what `evaluate_answer` later reads as the rubric.

## Conventions

- No DB access, no AI calls — this stays a pure content-transformation module. `Session.id` comes from the injected `generateId()` callback, not generated internally.
- If you change the algorithm-scope template (`buildAlgorithmScope`), keep the "Interviewer Guidance" section — it's what stops the interviewer-facing hints from leaking to the candidate (see the Interview Behavior Rules in the root `interview-mcp/CLAUDE.md`).
