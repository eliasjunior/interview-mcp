import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Flashcard, KnowledgeGraph, Mistake, Session, Skill } from "@mock-interview/shared";
import type { ToolDeps } from "../tools/deps.js";
import { registerAddSkillTool } from "../tools/addSkill.js";
import { registerGetSessionTool } from "../tools/getSession.js";
import { registerHelpTools } from "../tools/helpTools.js";
import { registerListMistakesTool } from "../tools/listMistakes.js";
import { registerListSessionsTool } from "../tools/listSessions.js";
import { registerListSkillsTool } from "../tools/listSkills.js";
import { registerListTopicsTool } from "../tools/listTopics.js";
import { registerLogMistakeTool } from "../tools/logMistake.js";
import { registerAllTools } from "../tools/registerAllTools.js";
import { registerServerStatusTool } from "../tools/serverStatus.js";
import { registerUpdateSkillTool } from "../tools/updateSkill.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type?: "text"; text: string }> }>;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    topic: "JWT authentication",
    interviewType: "design",
    state: "ENDED",
    currentQuestionIndex: 1,
    questions: ["What is JWT?", "How do you validate it?"],
    messages: [],
    evaluations: [
      {
        questionIndex: 0,
        question: "What is JWT?",
        answer: "A token format.",
        score: 3,
        feedback: "Covers the format but not trust boundaries.",
        needsFollowUp: true,
      },
    ],
    createdAt: "2026-03-28T10:00:00.000Z",
    endedAt: "2026-03-28T10:10:00.000Z",
    knowledgeSource: "file",
    ...overrides,
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    name: "2D index transformations",
    confidence: 2,
    subSkills: [
      { name: "layer boundaries", confidence: 2 },
      { name: "coordinate mapping", confidence: 2 },
    ],
    relatedProblems: ["rotate matrix"],
    createdAt: "2026-03-28T10:00:00.000Z",
    updatedAt: "2026-03-28T10:00:00.000Z",
    ...overrides,
  };
}

function makeMistake(overrides: Partial<Mistake> = {}): Mistake {
  return {
    id: "mistake-1",
    mistake: "Forgot to validate exp claim",
    pattern: "Happens when focusing only on the signature",
    fix: "Always validate registered claims after signature verification",
    topic: "JWT authentication",
    createdAt: "2026-03-28T10:05:00.000Z",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ToolDeps> = {}) {
  const sessions: Record<string, Session> = {
    "session-1": makeSession(),
    "session-2": makeSession({
      id: "session-2",
      topic: "Kafka",
      state: "WAIT_FOR_ANSWER",
      currentQuestionIndex: 0,
      evaluations: [],
      endedAt: undefined,
    }),
  };
  const graph: KnowledgeGraph = {
    nodes: [{ id: "jwt", label: "JWT", clusters: ["security"] }],
    edges: [{ source: "jwt", target: "claims", weight: 1, kind: "cooccurrence", relation: "co-occurs-with" }],
    sessions: ["session-1"],
  };
  const mistakes: Mistake[] = [makeMistake()];
  const skills: Skill[] = [makeSkill()];
  const deps: ToolDeps = {
    ai: null,
    knowledge: {
      listTopics: () => ["JWT authentication", "Kafka"],
      findByTopic: () => null,
    } as ToolDeps["knowledge"],
    uiPort: "5173",
    stateError: (msg) => ({ content: [{ type: "text", text: JSON.stringify({ error: msg }) }] }),
    loadSessions: () => sessions,
    saveSessions: () => {},
    loadGraph: () => graph,
    saveGraph: () => {},
    saveReport: (session) => `reports/${session.id}.md`,
    inspectSessionDeletion: () => null,
    deleteSessionById: () => null,
    loadFlashcards: () => [] as Flashcard[],
    saveFlashcard: () => {},
    saveFlashcards: () => {},
    loadFlashcardAnswersByState: () => [],
    saveFlashcardAnswer: () => {},
    updateFlashcardAnswer: () => {},
    loadMistakes: (topic?: string) => topic ? mistakes.filter((entry) => entry.topic === topic) : mistakes,
    saveMistake: (mistake) => {
      mistakes.push(mistake);
    },
    loadSkills: (maxConfidence?: number) =>
      maxConfidence == null ? skills : skills.filter((skill) => skill.confidence <= maxConfidence),
    findSkillByName: (name) => skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase()) ?? null,
    saveSkill: (skill) => {
      skills.push(skill);
    },
    updateSkill: (nextSkill) => {
      const idx = skills.findIndex((skill) => skill.id === nextSkill.id);
      if (idx !== -1) skills[idx] = nextSkill;
    },
    loadExercises: () => [],
    findExerciseByName: () => null,
    saveExercise: () => {},
    saveAlgorithmProblem: () => {},
    exercisesDir: "/tmp/exercises",
    scopesDir: "/tmp/scopes",
    generateId: () => `generated-${mistakes.length + skills.length}`,
    assertState: () => ({ ok: true }),
    findLast: <T,>(arr: T[], pred: (item: T) => boolean) => [...arr].reverse().find(pred),
    calcAvgScore: (evaluations) =>
      (evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0) / evaluations.length).toFixed(1),
    buildSummary: (session) => `Summary for ${session.topic}`,
    finalizeSession: async () => ({ summary: "done", avgScore: "4.0", concepts: [], reportFile: "report.md" }),
    saveWarmupHistory: () => {},
    loadWarmupStats: () => [],
    ...overrides,
  };

  return { deps, sessions, mistakes, skills };
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

describe("basic MCP tool handlers", () => {
  test("server_status reports topic, session, and graph counts", async () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerServerStatusTool, deps);

    const payload = parse(await handlers.get("server_status")!({}));
    assert.equal(payload.ok, true);
    assert.equal(payload.server, "interview-mcp");
    assert.equal(payload.topicsLoaded, 2);
    assert.equal(payload.sessions.total, 2);
    assert.equal(payload.sessions.ended, 1);
    assert.equal(payload.graph.nodes, 1);
  });

  test("help_tools filters exact names and returns stateError for missing tools", async () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerHelpTools, deps);

    const filtered = parse(await handlers.get("help_tools")!({ toolName: "list_topics" }));
    assert.equal(filtered.count, 1);
    assert.equal(filtered.tools[0].name, "list_topics");
    assert.equal(filtered.preflight.requiredFirstTool, "server_status");

    const missing = parse(await handlers.get("help_tools")!({ toolName: "not_a_tool" }));
    assert.equal(missing.error, "Tool 'not_a_tool' not found.");
  });

  test("list_topics and list_sessions return structured summaries", async () => {
    const { deps } = makeDeps();
    const topicHandlers = captureTool(registerListTopicsTool, deps);
    const sessionHandlers = captureTool(registerListSessionsTool, deps);

    const topics = parse(await topicHandlers.get("list_topics")!({}));
    assert.equal(topics.count, 2);
    assert.match(topics.instruction, /start_interview/);

    const result = parse(await sessionHandlers.get("list_sessions")!({}));
    assert.equal(result.total, 2);
    assert.equal(result.sessions[0].progress, "1/2");
    assert.equal(result.sessions[0].avgScore, "3.0");
    assert.equal(result.sessions[1].avgScore, null);
  });

  test("get_session returns a session and stateErrors for unknown ids", async () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerGetSessionTool, deps);

    const found = parse(await handlers.get("get_session")!({ sessionId: "session-1" }));
    assert.equal(found.id, "session-1");
    assert.equal(found.topic, "JWT authentication");

    const missing = parse(await handlers.get("get_session")!({ sessionId: "missing" }));
    assert.equal(missing.error, "Session 'missing' not found.");
  });

  test("log_mistake saves entries and list_mistakes can filter by topic", async () => {
    const { deps, mistakes } = makeDeps();
    const logHandlers = captureTool(registerLogMistakeTool, deps);
    const listHandlers = captureTool(registerListMistakesTool, deps);

    const logged = parse(await logHandlers.get("log_mistake")!({
      mistake: "Ignored audience claim",
      pattern: "Happens during rushed JWT reviews",
      fix: "Validate audience after verifying the signature",
      topic: "JWT authentication",
    }));
    assert.equal(logged.logged, true);
    assert.equal(mistakes.length, 2);

    const filtered = parse(await listHandlers.get("list_mistakes")!({ topic: "JWT authentication" }));
    assert.equal(filtered.total, 2);
    assert.equal(filtered.mistakes[0].topic, "JWT authentication");
  });

  test("add_skill, list_skills, and update_skill cover happy path and errors", async () => {
    const { deps, skills } = makeDeps();
    const addHandlers = captureTool(registerAddSkillTool, deps);
    const listHandlers = captureTool(registerListSkillsTool, deps);
    const updateHandlers = captureTool(registerUpdateSkillTool, deps);

    const duplicate = parse(await addHandlers.get("add_skill")!({
      name: "2D index transformations",
      subSkills: ["layer boundaries"],
      relatedProblems: [],
      confidence: 1,
    }));
    assert.match(duplicate.error, /already exists/);

    const added = parse(await addHandlers.get("add_skill")!({
      name: "Cache invalidation",
      subSkills: ["TTL strategy", "write-through tradeoffs"],
      relatedProblems: ["distributed cache"],
      confidence: 1,
    }));
    assert.equal(added.added, true);
    assert.equal(skills.length, 2);

    const listed = parse(await listHandlers.get("list_skills")!({ maxConfidence: 1 }));
    assert.equal(listed.total, 1);
    assert.equal(listed.skills[0].name, "Cache invalidation");

    const missingSkill = parse(await updateHandlers.get("update_skill")!({
      name: "Unknown skill",
      confidence: 3,
    }));
    assert.match(missingSkill.error, /not found/);

    const missingSubSkill = parse(await updateHandlers.get("update_skill")!({
      name: "2D index transformations",
      confidence: 3,
      subSkill: "missing sub-skill",
    }));
    assert.match(missingSubSkill.error, /Sub-skill "missing sub-skill" not found/);

    const updated = parse(await updateHandlers.get("update_skill")!({
      name: "2D index transformations",
      confidence: 4,
      subSkill: "layer boundaries",
    }));
    assert.equal(updated.updated, true);
    assert.equal(updated.skill.subSkills[0].confidence, 4);
    assert.equal(updated.skill.confidence, 3);
  });

  test("registerAllTools includes the basic handlers in the registry", () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerAllTools, deps);

    for (const toolName of [
      "server_status",
      "help_tools",
      "list_topics",
      "list_sessions",
      "get_session",
      "log_mistake",
      "list_mistakes",
      "add_skill",
      "list_skills",
      "update_skill",
    ]) {
      assert.equal(handlers.has(toolName), true, `expected ${toolName} to be registered`);
    }
  });
});
