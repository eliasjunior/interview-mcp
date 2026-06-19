import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import type { Exercise, Flashcard, KnowledgeGraph, Mistake, Session, Skill } from "@mock-interview/shared";
import type { ToolDeps } from "../tools/deps.js";
import { registerStartScopedInterviewTool } from "../tools/startScopedInterview.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

const tempFiles: string[] = [];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const addScopeDir = path.resolve(__dirname, "../../data/add-scope");

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    fs.rmSync(file, { force: true });
  }
});

function makeDeps(overrides: Partial<ToolDeps> = {}) {
  const sessions: Record<string, Session> = {};
  let savedSessions: Record<string, Session> | null = null;

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
    loadMistakes: () => [] as Mistake[],
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
    generateId: () => "scoped-session-1",
    assertState: () => ({ ok: true }),
    findLast: <T,>(arr: T[], pred: (item: T) => boolean) => [...arr].reverse().find(pred),
    calcAvgScore: () => "N/A",
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

describe("start_scoped_interview tool", () => {
  test("rejects providing both contentPath and content", async () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerStartScopedInterviewTool, deps);

    const payload = parse(await handlers.get("start_scoped_interview")!({
      topic: "Payments",
      contentPath: "add-scope/spec.md",
      content: "This is enough content to satisfy the validation threshold.",
    }));

    assert.equal(payload.error, "Provide contentPath OR content, not both.");
  });

  test("returns matching candidate files when neither contentPath nor content is provided", async () => {
    const filename = `payments-scope-${Date.now()}.md`;
    const filePath = path.join(addScopeDir, filename);
    fs.writeFileSync(filePath, "# Payments Scope\nPOST /payments\nPayment contains the fields amount (number)\n", "utf8");
    tempFiles.push(filePath);

    const { deps } = makeDeps();
    const handlers = captureTool(registerStartScopedInterviewTool, deps);

    const payload = parse(await handlers.get("start_scoped_interview")!({
      topic: "payments scope",
    }));

    assert.equal(payload.action, "confirm_file");
    assert.equal(payload.topic, "payments scope");
    assert.ok(payload.candidates.some((candidate: { filename: string }) => candidate.filename === filename));
    assert.match(payload.instruction, /call start_scoped_interview again with the chosen contentPath/);
  });

  test("returns a clear error when contentPath does not exist", async () => {
    const { deps } = makeDeps();
    const handlers = captureTool(registerStartScopedInterviewTool, deps);

    const payload = parse(await handlers.get("start_scoped_interview")!({
      topic: "Missing file",
      contentPath: "add-scope/does-not-exist.md",
    }));

    assert.match(payload.error, /File not found:/);
    assert.match(payload.error, /contentPath is resolved relative to interview-mcp\/data/);
  });

  test("creates a scoped session from inline API content", async () => {
    const { deps, sessions, getSavedSessions } = makeDeps();
    const handlers = captureTool(registerStartScopedInterviewTool, deps);

    const payload = parse(await handlers.get("start_scoped_interview")!({
      topic: "Payments API",
      focus: "reliability and validation",
      content: `
POST /payments (create payment)
GET /payments/{id} (fetch payment)

Payment contains the fields amount (number), currency (string), status (string)
Business rules
- amount must be greater than zero
- currency is required
- data is kept in memory on startup
      `.trim(),
    }));

    assert.equal(payload.sessionId, "scoped-session-1");
    assert.equal(payload.state, "ASK_QUESTION");
    assert.equal(payload.focusArea, "reliability and validation");
    assert.equal(payload.source, "inline content");
    assert.equal(payload.parsed.contentType, "api");
    assert.equal(payload.totalQuestions, 6);
    assert.equal(payload.previewQuestions.length, 2);
    assert.equal(payload.nextTool, "ask_question");

    const session = sessions["scoped-session-1"];
    assert.ok(session);
    assert.equal(session.questions.length, 6);
    assert.equal(session.focusArea, "reliability and validation");
    assert.match(session.customContent ?? "", /# Payments API — Structured Spec/);
    assert.deepEqual(getSavedSessions(), sessions);
  });

  test("wraps plain pasted algorithm prompts into structured scoped content", async () => {
    const { deps, sessions } = makeDeps();
    const handlers = captureTool(registerStartScopedInterviewTool, deps);

    const payload = parse(await handlers.get("start_scoped_interview")!({
      topic: "Linked Lists",
      problemTitle: "Delete Middle Node",
      interviewType: "code",
      focus: "algorithmic reasoning and edge cases",
      content: "Assume you have a method isSubstring which checks if one word is a substring of another. Given two strings, s1 and s2, write code to check if s2 is a rotation of s1 using only one call to isSubstring.",
    }));

    assert.equal(payload.parsed.contentType, "algorithm");
    assert.equal(payload.problemTitle, "Delete Middle Node");
    assert.match(payload.normalizedContent, /# Study Scope: Delete Middle Node/);
    assert.match(payload.normalizedContent, /## Subject Area\nLinked Lists/);
    assert.match(payload.normalizedContent, /## Problem Statement/);
    assert.equal(payload.totalQuestions, 3);
    assert.match(payload.instruction, /Hints are allowed when they are stuck/i);

    const session = sessions[payload.sessionId];
    assert.ok(session);
    assert.equal(session.topic, "Linked Lists");
    assert.equal(session.problemTitle, "Delete Middle Node");
    assert.match(session.customContent ?? "", /## Evaluation Criteria/);
    assert.match(session.customContent ?? "", /## Common Interview Follow-Ups \(interviewer only\)/);
    assert.match(session.customContent ?? "", /\*\*implementation\*\*/);
    assert.match(session.questions.at(-1) ?? "", /Now implement Delete Middle Node/);
  });

  test("treats a problem title as an algorithm signal for older callers", async () => {
    const { deps, sessions } = makeDeps();
    const handlers = captureTool(registerStartScopedInterviewTool, deps);

    const payload = parse(await handlers.get("start_scoped_interview")!({
      topic: "Arrays",
      problemTitle: "Two Sum",
      content: `
Given an array of integers nums and an integer target, return indices of the two numbers
such that they add up to target. You may assume that each input has exactly one solution.
      `.trim(),
    }));

    assert.equal(payload.parsed.contentType, "algorithm");
    assert.equal(payload.interviewType, "code");
    assert.equal(sessions[payload.sessionId]?.interviewType, "code");
    assert.match(sessions[payload.sessionId]?.questions.at(-1) ?? "", /Now implement Two Sum/);
  });

  test("creates a title-only code session that must be configured before interviewing", async () => {
    const { deps, sessions } = makeDeps();
    const handlers = captureTool(registerStartScopedInterviewTool, deps);

    const payload = parse(await handlers.get("start_scoped_interview")!({
      topic: "Strings",
      problemTitle: "Valid Anagram",
      interviewType: "code",
      focus: "correctness, edge cases, and complexity",
    }));

    assert.equal(payload.parsed.contentType, "algorithm");
    assert.equal(payload.problemTitle, "Valid Anagram");
    assert.equal(payload.interviewType, "code");
    assert.match(payload.normalizedContent, /Problem definition pending/);
    assert.equal(payload.nextTool, "configure_code_challenge");
    assert.match(payload.instruction, /call configure_code_challenge/i);

    const session = sessions[payload.sessionId];
    assert.ok(session);
    assert.match(session.customContent ?? "", /## Problem Statement/);
    assert.match(session.customContent ?? "", /configure "Valid Anagram"/);
  });
});
