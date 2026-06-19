import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { Exercise, Flashcard, KnowledgeGraph, Mistake, Session, Skill } from "@mock-interview/shared";
import type { ToolDeps } from "../tools/deps.js";
import { registerBuildScopeTool } from "../tools/buildScope.js";
import { registerCreateExerciseTool } from "../tools/createExercise.js";
import { registerListExercisesTool } from "../tools/listExercises.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeDeps(overrides: Partial<ToolDeps> = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "interview-mcp-scope-test-"));
  tempDirs.push(rootDir);

  const exercisesDir = path.join(rootDir, "exercises");
  const scopesDir = path.join(rootDir, "scopes");
  const exercises: Exercise[] = [];

  const deps: ToolDeps = {
    ai: null,
    knowledge: {
      listTopics: () => [],
      findByTopic: () => null,
    } as ToolDeps["knowledge"],
    uiPort: "5173",
    stateError: (msg) => ({ content: [{ type: "text", text: JSON.stringify({ error: msg }) }] }),
    loadSessions: () => ({} as Record<string, Session>),
    saveSessions: () => {},
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
    loadMistakes: () => [] as Mistake[],
    saveMistake: () => {},
    loadSkills: () => [] as Skill[],
    findSkillByName: () => null,
    saveSkill: () => {},
    updateSkill: () => {},
    loadExercises: (topic?: string, maxDifficulty?: number, tags?: string[]) =>
      exercises.filter((exercise) => {
        if (topic && exercise.topic !== topic) return false;
        if (maxDifficulty != null && exercise.difficulty > maxDifficulty) return false;
        if (tags && tags.length > 0 && !tags.every((tag) => exercise.tags.includes(tag))) return false;
        return true;
      }),
    findExerciseByName: (name) => exercises.find((exercise) => exercise.name === name) ?? null,
    saveExercise: (exercise) => {
      exercises.push(exercise);
    },
    saveAlgorithmProblem: () => {},
    exercisesDir,
    scopesDir,
    generateId: () => `generated-${exercises.length + 1}`,
    assertState: () => ({ ok: true }),
    findLast: <T,>(arr: T[], pred: (item: T) => boolean) => [...arr].reverse().find(pred),
    calcAvgScore: () => "N/A",
    buildSummary: () => "summary",
    finalizeSession: async () => ({ summary: "done", avgScore: "0.0", concepts: [], reportFile: "report.md" }),
    saveWarmupHistory: () => {},
    loadWarmupStats: () => [],
    ...overrides,
  };

  return { deps, exercises, rootDir };
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

describe("scope and exercise tools", () => {
  test("build_scope derives a session goal and returns reusable scope content", async () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerBuildScopeTool, deps);

    const payload = parse(await handlers.get("build_scope")!({
      topic: "JavaScript Runtime - Event Loop",
      focusAreas: ["event loop", "microtasks"],
      weakSpots: ["microtask ordering"],
      depth: "mixed",
      outOfScope: ["DOM APIs"],
    }));

    assert.equal(payload.topic, "JavaScript Runtime - Event Loop");
    assert.equal(payload.savedTo, null);
    assert.match(payload.content, /## Focus Areas/);
    assert.match(payload.content, /## Known Weak Spots/);
    assert.match(payload.content, /## Out of Scope/);
    assert.match(payload.content, /Candidate can explain event loop, microtasks/);
  });

  test("build_scope persists scope files when saveAs is provided", async () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerBuildScopeTool, deps);

    const payload = parse(await handlers.get("build_scope")!({
      topic: "Kafka consumer reliability",
      focusAreas: ["offset management", "retry strategy"],
      weakSpots: [],
      depth: "conceptual",
      outOfScope: [],
      sessionGoal: "Explain retries and offsets clearly.",
      saveAs: "Kafka Consumer Reliability",
    }));

    assert.ok(typeof payload.savedTo === "string");
    assert.match(payload.savedTo, /kafka-consumer-reliability\.md$/);
    assert.equal(fs.existsSync(payload.savedTo), true);

    const saved = fs.readFileSync(payload.savedTo, "utf8");
    assert.match(saved, /# Study Scope: Kafka consumer reliability/);
    assert.match(saved, /## Session Goal/);
  });

  test("create_exercise writes markdown, persists metadata, and reports unmet prerequisites", async () => {
    const { deps, exercises } = makeDeps();
    const handlers = captureTool(registerCreateExerciseTool, deps);

    const payload = parse(await handlers.get("create_exercise")!({
      name: "RaceConditionLab",
      topic: "java-concurrency",
      language: "java",
      difficulty: 4,
      description: "Observe a race condition and fix it.",
      scenario: "Background job processor",
      problemMeaning: ["Races corrupt counters", "Production metrics become unreliable"],
      tags: ["concurrency", "shared-state"],
      learningGoal: "Understand why unsynchronized increments lose updates.",
      problemStatement: "Implement a shared counter and fix the race.",
      steps: ["Write naive version", "Fix with synchronized", "Fix with AtomicInteger"],
      evaluationCriteria: ["Explains race condition", "Uses correct synchronization"],
      hints: ["Try many threads"],
      relatedConcepts: ["java-concurrency.md: race condition, atomicity"],
      prerequisites: [{ name: "AtomicCounterBasics", reason: "Need baseline atomicity intuition" }],
    }));

    assert.equal(payload.created, true);
    assert.equal(exercises.length, 1);
    assert.equal(payload.exercise.slug, "raceconditionlab");
    assert.equal(payload.complexityAssessment.tooHard, true);
    assert.deepEqual(payload.complexityAssessment.unmetPrerequisites, ["AtomicCounterBasics"]);
    assert.match(payload.filePath, /java-concurrency\/raceconditionlab\.md$/);
    assert.equal(fs.existsSync(payload.filePath), true);

    const markdown = fs.readFileSync(payload.filePath, "utf8");
    assert.match(markdown, /# Exercise: RaceConditionLab/);
    assert.match(markdown, /## Implementation Steps/);
    assert.match(markdown, /AtomicCounterBasics/);
  });

  test("create_exercise reports duplicates and list_exercises groups by topic with filters", async () => {
    const { deps, exercises } = makeDeps({
      findExerciseByName: (name) => exercises.find((exercise) => exercise.name === name) ?? null,
    });

    exercises.push({
      id: "ex-1",
      name: "CachePrimer",
      slug: "cacheprimer",
      topic: "system-design",
      language: "typescript",
      difficulty: 2,
      description: "Basic cache aside exercise",
      scenario: "Catalog service",
      problemMeaning: ["Reduce latency"],
      tags: ["cache", "latency"],
      prerequisites: [],
      filePath: path.join("system-design", "cacheprimer.md"),
      createdAt: "2026-03-28T10:00:00.000Z",
    });

    const createHandlers = captureTool(registerCreateExerciseTool, deps);
    const listHandlers = captureTool(registerListExercisesTool, deps);

    const duplicate = parse(await createHandlers.get("create_exercise")!({
      name: "CachePrimer",
      topic: "system-design",
      language: "typescript",
      difficulty: 2,
      description: "Duplicate",
      scenario: "Catalog service",
      problemMeaning: ["Reduce latency"],
      tags: ["cache"],
      learningGoal: "Learn cache basics",
      problemStatement: "Build a cache",
      steps: ["step 1"],
      evaluationCriteria: ["criterion 1"],
      hints: [],
      relatedConcepts: [],
      prerequisites: [],
    }));
    assert.match(duplicate.error, /already exists/);

    exercises.push({
      id: "ex-2",
      name: "RetryDesign",
      slug: "retrydesign",
      topic: "system-design",
      language: "typescript",
      difficulty: 3,
      description: "Retry policy exercise",
      scenario: "API client",
      problemMeaning: ["Improve resilience"],
      tags: ["retry", "resilience"],
      prerequisites: [],
      filePath: path.join("system-design", "retrydesign.md"),
      createdAt: "2026-03-28T10:05:00.000Z",
    });

    const listed = parse(await listHandlers.get("list_exercises")!({
      topic: "system-design",
      maxDifficulty: 2,
      tags: ["cache"],
    }));

    assert.equal(listed.total, 1);
    assert.equal(listed.byTopic.length, 1);
    assert.equal(listed.byTopic[0].topic, "system-design");
    assert.equal(listed.byTopic[0].exercises[0].name, "CachePrimer");
  });
});
