import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Exercise, Flashcard, KnowledgeGraph, Mistake, Session, Skill } from "@mock-interview/shared";
import type { ToolDeps } from "../tools/deps.js";
import { registerStartDrillTool } from "../tools/startDrill.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function makeEndedSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    topic: "JWT authentication",
    interviewType: "design",
    sessionKind: "interview",
    state: "ENDED",
    currentQuestionIndex: 2,
    questions: ["What is JWT?", "How do you validate it?"],
    messages: [],
    evaluations: [
      {
        questionIndex: 0,
        question: "What is JWT?",
        answer: "A token format.",
        score: 2,
        feedback: "Missed trust boundaries and signature verification details.",
        needsFollowUp: true,
        strongAnswer: "A signed token; validate signature, issuer, audience, and expiration.",
      },
      {
        questionIndex: 1,
        question: "How do you validate it?",
        answer: "Check claims.",
        score: 5,
        feedback: "Good answer.",
        needsFollowUp: false,
      },
    ],
    createdAt: "2026-03-28T10:00:00.000Z",
    endedAt: "2026-03-28T10:15:00.000Z",
    knowledgeSource: "file",
    ...overrides,
  };
}

function makeMistake(overrides: Partial<Mistake> = {}): Mistake {
  return {
    id: "mistake-1",
    mistake: "Skipped issuer validation",
    pattern: "Focuses only on token decoding and misses verification",
    fix: "Always verify signature and registered claims together",
    topic: "JWT authentication",
    createdAt: "2026-03-28T10:20:00.000Z",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ToolDeps> = {}) {
  const sessions: Record<string, Session> = {};
  let savedSessions: Record<string, Session> | null = null;
  let generated = 0;

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
    inspectSessionDeletion: () => null,
    deleteSessionById: () => null,
    loadFlashcards: () => [] as Flashcard[],
    saveFlashcard: () => {},
    saveFlashcards: () => {},
    loadFlashcardAnswersByState: () => [],
    saveFlashcardAnswer: () => {},
    updateFlashcardAnswer: () => {},
    loadMistakes: (topic?: string) => topic ? [makeMistake()].filter((item) => item.topic === topic) : [makeMistake()],
    saveMistake: () => {},
    loadSkills: () => [] as Skill[],
    findSkillByName: () => null,
    saveSkill: () => {},
    updateSkill: () => {},
    loadExercises: () => [] as Exercise[],
    findExerciseByName: () => null,
    saveExercise: () => {},
    saveAlgorithmProblem: () => {},
    exercisesDir: "/tmp/exercises",
    scopesDir: "/tmp/scopes",
    generateId: () => `drill-session-${++generated}`,
    assertState: () => ({ ok: true }),
    findLast: <T,>(arr: T[], pred: (item: T) => boolean) => [...arr].reverse().find(pred),
    calcAvgScore: (evaluations) =>
      (evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0) / evaluations.length).toFixed(1),
    buildSummary: () => "summary",
    finalizeSession: async () => ({ summary: "done", avgScore: "0.0", concepts: [], reportFile: "report.md" }),
    saveWarmupHistory: () => {},
    loadWarmupStats: () => [],
    ...overrides,
  };

  return { deps, sessions, getSavedSessions: () => savedSessions };
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

describe("start_drill tool", () => {
  test("errors when no completed sessions exist for the topic", async () => {
    const { deps } = makeDeps({
      loadSessions: () => ({
        active: makeEndedSession({
          id: "active",
          topic: "Kafka",
          state: "WAIT_FOR_ANSWER",
          endedAt: undefined,
          evaluations: [],
        }),
      }),
    });
    const handlers = captureTool(registerStartDrillTool, deps);

    const payload = parse(await handlers.get("start_drill")!({ topic: "JWT authentication" }));
    assert.match(payload.error, /No completed sessions found for "JWT authentication"/);
    assert.match(payload.error, /start_interview/);
  });

  test("errors for unknown or unfinished explicit session ids", async () => {
    const sessions = {
      "session-1": makeEndedSession(),
      "session-2": makeEndedSession({
        id: "session-2",
        state: "FOLLOW_UP",
        endedAt: undefined,
      }),
    };
    const { deps } = makeDeps({
      loadSessions: () => sessions,
    });
    const handlers = captureTool(registerStartDrillTool, deps);

    const missing = parse(await handlers.get("start_drill")!({
      topic: "JWT authentication",
      sessionId: "missing",
    }));
    assert.equal(missing.error, 'Session "missing" not found.');

    const unfinished = parse(await handlers.get("start_drill")!({
      topic: "JWT authentication",
      sessionId: "session-2",
    }));
    assert.equal(unfinished.error, 'Session "session-2" is not completed yet.');
  });

  test("returns no_weak_spots when the source session has no weak answers or mistakes", async () => {
    const sessions = {
      "session-1": makeEndedSession({
        evaluations: [{
          questionIndex: 0,
          question: "What is JWT?",
          answer: "A token format.",
          score: 4,
          feedback: "Good answer.",
          needsFollowUp: false,
        }],
      }),
    };
    const { deps } = makeDeps({
      loadSessions: () => sessions,
      loadMistakes: () => [],
    });
    const handlers = captureTool(registerStartDrillTool, deps);

    const payload = parse(await handlers.get("start_drill")!({ topic: "JWT authentication" }));
    assert.equal(payload.status, "no_weak_spots");
    assert.equal(payload.avgScore, "4.0");
    assert.equal(payload.sourceSessionId, "session-1");
  });

  test("creates a drill session from the most recent completed session and includes recall context", async () => {
    const sessions = {
      older: makeEndedSession({
        id: "older",
        createdAt: "2026-03-20T10:00:00.000Z",
      }),
      newer: makeEndedSession({
        id: "newer",
        createdAt: "2026-03-29T10:00:00.000Z",
      }),
    };
    const { deps, getSavedSessions } = makeDeps({
      loadSessions: () => sessions,
    });
    const handlers = captureTool(registerStartDrillTool, deps);

    const payload = parse(await handlers.get("start_drill")!({ topic: "JWT authentication" }));
    assert.equal(payload.sessionKind, "drill");
    assert.equal(payload.sourceSessionId, "newer");
    assert.equal(payload.totalDrillQuestions, 1);
    assert.equal(payload.recallContext.knownMistakes.length, 1);
    assert.equal(payload.recallContext.weakAreas.length, 1);
    assert.equal(payload.nextTool, "ask_question");

    const createdSession = getSavedSessions()?.[payload.sessionId];
    assert.ok(createdSession);
    assert.equal(createdSession?.sessionKind, "drill");
    assert.equal(createdSession?.questions[0], "What is JWT?");
    assert.match(createdSession?.customContent ?? "", /Drill Session — JWT authentication/);
    assert.match(createdSession?.focusArea ?? "", /Targeted drill/);
  });
});
