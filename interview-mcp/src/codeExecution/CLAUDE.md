# interview-mcp/src/codeExecution — Context

Single file: `runner.ts`, exporting `runCodeChallenge(challenge: StoredCodeChallenge, source: string)`. This is what the `run_code` tool (`../tools/runCode.ts`) calls to compile/execute candidate-submitted code against the challenge's private test harness.

## Security note — this executes untrusted code with OS-level isolation only

`runCodeChallenge` runs the **candidate's raw source** as a real process on the host machine (`execFile` to `node` or `javac`/`java`). The only containment is:
- a fresh `fs.mkdtemp` temp directory per run, removed in a `finally` block
- `RUN_TIMEOUT_MS` (4s) / `COMPILE_TIMEOUT_MS` (10s) timeouts passed to `execFile`
- `MAX_OUTPUT_BYTES` (128 KB) via `maxBuffer`, `MAX_SOURCE_CHARS` (100k) source-length cap
- a trimmed `env` (`PATH`, `JAVA_HOME`, `HOME`/`TMPDIR` pointed at the temp dir, `LANG=C`)

There is **no container, VM, seccomp filter, or network restriction** — the process runs with the same OS privileges as the `interview-mcp` server itself. This is acceptable for the current single-user, localhost-only usage (see root `interview-mcp/CLAUDE.md` — `dev:http` binds `0.0.0.0` but is intended for LAN-only personal use), but this module must **not** be exposed to untrusted/multi-tenant callers without adding real sandboxing (e.g. gVisor, Firecracker, Docker with dropped capabilities, or a language-specific sandboxed runtime) first.

## Flow

1. Reject empty or over-length (`MAX_SOURCE_CHARS`) source up front — no process spawned.
2. Create a scratch temp dir.
3. **JavaScript** (`challenge.language === "javascript"`): write `candidate.cjs` containing the candidate source followed by `challenge.testHarness` appended as a "Hidden test harness" comment block, run directly with `node`.
4. **Java** (anything else): write `Solution.java` (candidate source) and `TestRunner.java` (`challenge.testHarness`), compile both with `javac`, then run `java -cp <workDir> TestRunner`. A failed/timed-out compile short-circuits before the run phase.
5. Always clean up the temp dir (`fs.rm ... force: true`) in `finally`, even on error.

`execute()` is the low-level `execFile` wrapper — normalizes exit code, detects a `SIGTERM` timeout kill, and captures stdout/stderr. `result()` maps a `CommandResult` into the shared `CodeRunResult` shape (`ok`, `phase: "compile" | "test"`, `exitCode`, `timedOut`, `durationMs`, `stdout`, `stderr`) returned to the tool layer and ultimately the UI.

## Conventions

- Any new supported language needs its own branch here mirroring the JS/Java pattern: write candidate source + test harness to the temp dir, compile if needed, run with a timeout, return via `result()`.
- Do not weaken the existing limits (`RUN_TIMEOUT_MS`, `MAX_OUTPUT_BYTES`, `MAX_SOURCE_CHARS`) without re-reading the security note above.
