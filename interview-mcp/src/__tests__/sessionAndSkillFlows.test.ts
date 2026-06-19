import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Exercise, Flashcard, KnowledgeGraph, Mistake, Session, Skill } from "@mock-interview/shared";
import type { ToolDeps } from "../tools/deps.js";
import { registerDeleteSessionTool } from "../tools/deleteSession.js";
import { registerPracticeMicroSkillTool } from "../tools/practiceMicroSkill.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    name: "2D index transformations",
    confidence: 2,
    subSkills: [
      { name: "layer boundaries", confidence: 1 },
      { name: "coordinate mapping", confidence: 3 },
    ],
    relatedProblems: ["rotate matrix", "spiral matrix"],
    createdAt: "2026-03-28T10:00:00.000Z",
    updatedAt: "2026-03-28T10:00:00.000Z",
    ...overrides,
  };
}

function makeMistake(overrides: Partial<Mistake> = {}): Mistake {
  return {
    id: "mistake-1",
    mistake: "Off-by-one in layer iteration",
    pattern: "Happens when computing last index per ring",
    fix: "Derive layer bounds before rotating elements",
    topic: "2D index transformations",
    createdAt: "2026-03-28T10:05:00.000Z",
    ...overrides,
  };
}

function makeDeletionPreview() {
  return {
    session: {
      id: "session-1",
      topic: "JWT authentication",
      state: "ENDED",
      createdAt: "2026-03-28T10:00:00.000Z",
      endedAt: "2026-03-28T10:10:00.000Z",
      questionCount: 2,
      messageCount: 4,
      evaluationCount: 2,
      conceptCount: 3,
      hasSummary: true,
    },
    flashcards: {
      count: 1,
      ids: ["fc-session-1-q0"],
    },
    graph: {
      includedInGraphSessions: true,
      rebuildRequired: true,
      currentNodeCount: 8,
      currentEdgeCount: 6,
    },
    artifacts: {
      markdownReport: true,
      reportUiDataset: true,
      weakSubjectsHtml: false,
    },
    warnings: [
      "Deleting this session will also delete 1 sourced flashcard(s).",
      "Graph must be rebuilt after deletion because this session contributes derived graph state.",
    ],
  };
}

function makeDeps(overrides: Partial<ToolDeps> = {}) {
  const sessions: Record<string, Session> = {};
  const mistakes: Mistake[] = [makeMistake()];
  const skills: Skill[] = [makeSkill()];
  let savedSessions: Record<string, Session> | null = null;
  let generatedCount = 0;

  const deps: ToolDeps = {
    ai: null,
    knowledge: {
      listTopics: () => [],
      findByTopic: () => null,
    } as ToolDeps["knowledge"],
    uiPort: "5173",
    stateError: (msg) => ({ content: [{ type: "text", text: JSON.stringify({ error: msg }) }] }),
    loadSessions: () => sessions,
    saveSessions: (next) => {
      savedSessions = next;
      Object.assign(sessions, next);
    },
    loadGraph: () => ({ nodes: [], edges: [], sessions: [] } as KnowledgeGraph),
    saveGraph: () => {},
    saveReport: () => "report.md",
    inspectSessionDeletion: (sessionId) => (sessionId === "session-1" ? makeDeletionPreview() : null),
    deleteSessionById: (sessionId) => sessionId === "session-1"
      ? {
          preview: makeDeletionPreview(),
          deletedFlashcards: 1,
          deletedArtifacts: ["session-1.md", "session-1-report-ui.json"],
          graph: { nodes: 5, edges: 4, sessions: 2 },
        }
      : null,
    loadFlashcards: () => [] as Flashcard[],
    saveFlashcard: () => {},
    saveFlashcards: () => {},
    loadFlashcardAnswersByState: () => [],
    saveFlashcardAnswer: () => {},
    updateFlashcardAnswer: () => {},
    loadMistakes: (topic?: string) => topic ? mistakes.filter((entry) => entry.topic === topic) : mistakes,
    saveMistake: () => {},
    loadSkills: () => skills,
    findSkillByName: (name) => skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase()) ?? null,
    saveSkill: () => {},
    updateSkill: () => {},
    loadExercises: () => [] as Exercise[],
    findExerciseByName: () => null,
    saveExercise: () => {},
    saveAlgorithmProblem: () => {},
    exercisesDir: "/tmp/exercises",
    scopesDir: "/tmp/scopes",
    generateId: () => `generated-${++generatedCount}`,
    assertState: () => ({ ok: true }),
    findLast: <T,>(arr: T[], pred: (item: T) => boolean) => [...arr].reverse().find(pred),
    calcAvgScore: () => "3.0",
    buildSummary: () => "summary",
    finalizeSession: async () => ({ summary: "done", avgScore: "3.0", concepts: [], reportFile: "report.md" }),
    saveWarmupHistory: () => {},
    loadWarmupStats: () => [],
    ...overrides,
  };

  return { deps, sessions, mistakes, skills, getSavedSessions: () => savedSessions };
}

function captureTool(register: (server: any, deps: ToolDeps) => void, deps: ToolDeps) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool(name: string, _config: object, handler: Handler) {
      handlers.set(name, handler);
    },
  };
  register(server, deps);
  return handlers;
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

describe("session deletion and micro-skill flow tools", () => {
  test("delete_session supports dry-run preview, deletion, and missing-session errors", async () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerDeleteSessionTool, deps);

    const missing = parse(await handlers.get("delete_session")!({ sessionId: "missing", dryRun: true }));
    assert.equal(missing.error, "Session 'missing' not found.");

    const dryRun = parse(await handlers.get("delete_session")!({ sessionId: "session-1", dryRun: true }));
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.preview.session.id, "session-1");
    assert.match(dryRun.instruction, /dryRun=false/);

    const deleted = parse(await handlers.get("delete_session")!({ sessionId: "session-1", dryRun: false }));
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.deletedFlashcards, 1);
    assert.deepEqual(deleted.deletedArtifacts, ["session-1.md", "session-1-report-ui.json"]);
    assert.equal(deleted.graphAfterRebuild.nodes, 5);
  });

  test("practice_micro_skill errors for missing skills or invalid sub-skills", async () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerPracticeMicroSkillTool, deps);

    const missingSkill = parse(await handlers.get("practice_micro_skill")!({ skill: "unknown skill" }));
    assert.match(missingSkill.error, /not found in backlog/);

    const missingSubSkill = parse(await handlers.get("practice_micro_skill")!({
      skill: "2D index transformations",
      subSkill: "unknown sub-skill",
    }));
    assert.match(missingSubSkill.error, /Sub-skill "unknown sub-skill" not found/);
    assert.deepEqual(missingSubSkill.availableSubSkills, ["layer boundaries", "coordinate mapping"]);
  });

  test("practice_micro_skill auto-picks the weakest sub-skill and creates a drill session", async () => {
    const { deps, sessions, getSavedSessions } = makeDeps();
    const handlers = captureTool(registerPracticeMicroSkillTool, deps);

    const payload = parse(await handlers.get("practice_micro_skill")!({
      skill: "2D index transformations",
    }));

    assert.equal(payload.skill, "2D index transformations");
    assert.equal(payload.subSkill, "layer boundaries");
    assert.equal(payload.nextTool, "ask_question");
    assert.equal(payload.recallPrompt.currentConfidence, 1);
    assert.equal(payload.recallPrompt.knownMistakes.length, 1);
    assert.equal(typeof payload.sessionId, "string");

    const createdSession = sessions[payload.sessionId];
    assert.ok(createdSession);
    assert.equal(createdSession.sessionKind, "drill");
    assert.equal(createdSession.state, "ASK_QUESTION");
    assert.equal(createdSession.focusArea, "Micro-skill drill: layer boundaries");
    assert.match(createdSession.customContent ?? "", /Known mistake patterns/);
    assert.deepEqual(getSavedSessions(), sessions);
  });
});
