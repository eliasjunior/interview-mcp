# interview-mcp/src/codeChallenges — Context

Single file: `problemDefinition.ts`. Pure markdown-rendering for the candidate-facing problem statement of a code-interview challenge, used by `../tools/configureCodeChallenge.ts` (`configure_code_challenge` tool).

## `problemDefinition.ts`

- `renderCodeProblemDefinition({ problemStatement, examples, constraints })` — renders `problemStatement`, then a numbered `### Examples` section (Input/Output/optional Explanation per example), then a `### Constraints` bullet list.
- `replaceProblemStatement(customContent, definition)` — splices the rendered definition into a session's existing `customContent` under a `## Problem Statement` heading: replaces the heading's content if it already exists (regex match to end of string), otherwise appends a new `## Problem Statement` section.

This only builds the **candidate-facing statement**. The executable side of a code challenge (`testHarness`, `referenceSolution`, private tests) lives on `StoredCodeChallenge` (`../repositories/codeChallengeRepository.ts`) and is executed by `../codeExecution/runner.ts` — see that folder's `CLAUDE.md`.

## Conventions

- Keep pure — no DB access. `configure_code_challenge` is responsible for persisting the `StoredCodeChallenge` record via `deps.saveCodeChallenge`.
- `replaceProblemStatement`'s heading-replace regex (`/##\s+Problem Statement\s*\n[\s\S]*$/i`) assumes `## Problem Statement` is the **last** section in `customContent` — if you add content that must appear after it, this splice logic needs to change too.
