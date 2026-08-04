# interview-mcp/src/graph — Context

Concept-normalization logic backing the knowledge graph feature (`GET /api/graph`, the D3 graph view in the `ui` package). The graph-merge entry point itself lives one level up at `../graphUtils.ts` — `mergeConceptsIntoGraph(graph, concepts, sessionId)` — and imports everything it needs from this folder. Read the two together; `graphUtils.ts` is the orchestrator, `graph/concepts.ts` is where concept identity is decided.

## `concepts.ts`

**Canonicalization** — every concept word extracted from an evaluation gets mapped to a stable node id before it touches the graph, so `"thread dump"`, `"thread-dump"`, and `"Thread Dumps"` all collapse to the same node.

- `CANONICAL_CONCEPTS` — hand-maintained seed list of `{ id, label, aliases[] }`. Currently JVM-threading-focused (thread dump, heap dump, lock contention, GC thread, etc.) — this list grows as new topics get concept-tagged.
- `canonicalizeConceptWord(word)` — looks up the alias map (`conceptsByAlias`, built once at module load from `CANONICAL_CONCEPTS`); falls through to a slugified version of the raw word if it's not a known canonical concept, so unrecognized concepts still get a stable id rather than being dropped.
- `normalizeAliasKey(value)` — lowercase, strip quotes, collapse whitespace/underscores to single hyphens. This is the shared key format for both the alias map and unseen words.

**Filtering** — `SEMANTIC_ONLY_CONCEPT_IDS` is a set of concept ids that should generate a *semantic edge* (see below) but never become their own graph node — they're relational statements (e.g. `use-bigdecimal-for-money`), not standalone concepts. `filterGraphNodeConcepts` strips them before node creation; `isSemanticOnlyConcept` is the membership check.

**Semantic edges** — `deriveSemanticConceptEdges(concepts)` turns specific concept-id *patterns* into typed edges between two other (real) nodes:
- `use-X-for-Y` → edge `X --used-for--> Y`
- `classify-*-vs-*` → fixed edge `jvm-internal-threads --contrasts-with--> app-threads`
- A short hardcoded set of direct associations (`thread-dump --diagnoses--> lock-contention`, etc.) via `buildSemanticAssociationEdges`

Edges are always normalized to a stable `[source, target]` sort order (`normalizeSemanticEdge`) so `A→B` and `B→A` never produce duplicate edges.

## `../graphUtils.ts` — `mergeConceptsIntoGraph`

Called once per session close (from `finalizeSession` in the tools layer) and by `../db/rebuildGraph.ts` when replaying the whole history. For a batch of concepts from one session:

1. Normalize + canonicalize (via `concepts.ts`), filter out semantic-only ids.
2. Upsert a graph node per unique canonical concept id; merge in any new `cluster` membership.
3. Add **co-occurrence edges** between concepts that share a `cluster` within the session, weight incremented on repeat.
4. Add weaker **bridge co-occurrence edges** between concepts that appeared in the same session but don't share a cluster — keeps otherwise-unrelated areas of the graph connected.
5. Add **semantic edges** from `deriveSemanticConceptEdges`.
6. Record the session id on the graph (`graph.sessions`) if not already present.

Mutates and returns the passed-in `graph` object — callers pass the currently-loaded `KnowledgeGraph`, get the updated one back, and persist it via `deps.saveGraph()`.

## Conventions

- Adding a new canonical concept: add an entry to `CANONICAL_CONCEPTS` in `concepts.ts` with all known aliases up front — retrofitting aliases later does not relabel already-persisted graph nodes (the stored `id` won't change, only `label` on next merge).
- Adding a new semantic-edge rule: extend `buildSemanticPatternEdges` (pattern-based) or `buildSemanticAssociationEdges` (fixed pairs) in `concepts.ts`. Keep edges symmetric-safe — `normalizeSemanticEdge` handles sort order, don't hand-sort in the rule itself.
- This module has no DB or MCP dependencies — pure functions over `Concept[]` / `KnowledgeGraph` data. Keep it that way; persistence stays in `../db/repositories/sqliteGraphRepository.ts`.
