import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { Evaluation, KnowledgeGraph, Session } from "@mock-interview/shared";
import type { ToolDeps } from "../tools/deps.js";
import { registerGenerateReportUiTool } from "../tools/generateReportUi.js";
import { registerGetGraphTool } from "../tools/getGraph.js";
import { registerGetProgressOverviewTool } from "../tools/getProgressOverview.js";
import { registerGetReportFullContextTool } from "../tools/getReportFullContext.js";
import { registerGetReportWeakSubjectsTool } from "../tools/getReportWeakSubjects.js";
import { registerHelpTools } from "../tools/helpTools.js";
import { registerRegenerateReportTool } from "../tools/regenerateReport.js";
import { registerAllTools } from "../tools/registerAllTools.js";
import { registerServerStatusTool } from "../tools/serverStatus.js";

type RegisteredHandler = (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    questionIndex: 0,
    question: "Explain JWT validation.",
    answer: "Check signature and claims.",
    score: 2,
    feedback: "Missed claim validation details.",
    needsFollowUp: true,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    topic: "JWT",
    state: "ENDED",
    currentQuestionIndex: 0,
    questions: ["Explain JWT validation."],
    messages: [],
    evaluations: [makeEvaluation()],
    createdAt: "2026-03-28T09:00:00.000Z",
    endedAt: "2026-03-28T09:20:00.000Z",
    knowledgeSource: "file",
    summary: "JWT interview summary",
    ...overrides,
  };
}

function makeGraph(): KnowledgeGraph {
  return {
    nodes: [{ id: "jwt", label: "JWT", clusters: ["security"] }],
    edges: [{ source: "jwt", target: "claims", weight: 1, kind: "cooccurrence" as const, relation: "related" }],
    sessions: ["session-1"],
  };
}

function makeStateError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  };
}

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  const sessions: Record<string, Session> = {
    "session-1": makeSession(),
  };
  const graph = makeGraph();
  const generatedUiDir = fs.mkdtempSync(path.join(os.tmpdir(), "report-mcp-ui-"));
  tempDirs.push(generatedUiDir);
  let savedSessions = sessions;
  let savedReportSession: Session | null = null;

  return {
    ai: null,
    uiPort: "5173",
    generatedUiDir,
    stateError: makeStateError,
    loadSessions: () => savedSessions,
    saveSessions: (next) => {
      savedSessions = next;
    },
    loadGraph: () => graph,
    saveReport: (session) => {
      savedReportSession = session;
      return path.join(generatedUiDir, `${session.id}.md`);
    },
    ensureGeneratedUiDir: () => {
      fs.mkdirSync(generatedUiDir, { recursive: true });
    },
    writeTextFile: (filePath, content) => {
      fs.writeFileSync(filePath, content, "utf8");
    },
    calcAvgScore: (evaluations) => {
      const avg = evaluations.reduce((sum, e) => sum + e.score, 0) / evaluations.length;
      return avg.toFixed(1);
    },
    buildSummary: (session) => `Summary for ${session.topic}`,
    pickSessionByTopic: (allSessions, topic) =>
      Object.values(allSessions).find((session) => session.topic === topic && session.state === "ENDED") ?? null,
    extractWeakSubjects: (session) =>
      session.evaluations
        .filter((evaluation) => evaluation.score <= 3)
        .map((evaluation) => ({
          questionIndex: evaluation.questionIndex,
          question: evaluation.question,
          subject: "JWT claims",
          score: evaluation.score,
          gapSummary: "Missed issuer and expiration checks.",
          exampleAnswer: "Validate signature, issuer, audience, and expiration.",
        })),
    buildFullQuestionContext: (session, weakScoreThreshold) =>
      session.evaluations.map((evaluation) => ({
        askedOrder: evaluation.questionIndex + 1,
        questionNumber: evaluation.questionIndex + 1,
        subject: "JWT claims",
        question: evaluation.question,
        candidateAnswer: evaluation.answer,
        strongAnswer: evaluation.strongAnswer,
        interviewerFeedback: evaluation.feedback,
        score: evaluation.score,
        isWeak: evaluation.score <= weakScoreThreshold,
        gapSummary: "Missed issuer and expiration checks.",
      })),
    buildProgressOverview: () => ({
      generatedAt: "2026-03-28T09:00:00.000Z",
      filters: { sessionKind: "all" as const, weakScoreThreshold: 3, recentSessionsLimit: 5, topicLimit: 10 },
      totals: {
        sessions: 1,
        topics: 1,
        questionsAnswered: 1,
        avgScore: "2.0",
        weakQuestions: 1,
        weakQuestionRate: "100.0%",
        followUpCount: 1,
        followUpRate: "100.0%",
        firstSessionAt: "2026-03-28T09:00:00.000Z",
        lastSessionAt: "2026-03-28T09:20:00.000Z",
      },
      scoreDistribution: { "1": 0, "2": 1, "3": 0, "4": 0, "5": 0 },
      scoreTrend: [{ sessionId: "session-1", endedAt: "2026-03-28T09:20:00.000Z", avgScore: "2.0", topic: "JWT" }],
      recentSessions: [{ sessionId: "session-1", topic: "JWT", sessionKind: "interview" as const, createdAt: "2026-03-28T09:00:00.000Z", endedAt: "2026-03-28T09:20:00.000Z", avgScore: "2.0", questionCount: 1, weakQuestionCount: 1, followUpCount: 1 }],
      topicBreakdown: [{ topic: "JWT", sessionCount: 1, avgScore: "2.0", latestScore: "2.0", deltaFromFirst: "0.0", totalQuestions: 1, weakQuestions: 1, weakQuestionRate: "100.0%", lastSessionAt: "2026-03-28T09:20:00.000Z" }],
      repeatedTopics: [],
    }),
    countLines: (text) => text.split("\n").length,
    escapeHtml: (value) => value,
    serializeForInlineScript: (value) => JSON.stringify(value),
    ...overrides,
  };
}

function captureTool(register: (server: any, deps: ToolDeps) => void, deps: ToolDeps) {
  const handlers = new Map<string, RegisteredHandler>();
  const server = {
    registerTool(name: string, _schema: unknown, handler: RegisteredHandler) {
      handlers.set(name, handler);
    },
  };

  register(server, deps);
  return handlers;
}

function parsePayload(result: { content: Array<{ type: "text"; text: string }> }) {
  assert.equal(result.content[0]?.type, "text");
  return JSON.parse(result.content[0]!.text);
}

describe("report tool handlers", () => {
  test("server_status returns runtime counts and help_tools can filter exact tool names", async () => {
    const deps = makeDeps();
    const statusHandlers = captureTool(registerServerStatusTool, deps);
    const helpHandlers = captureTool(registerHelpTools, deps);

    const status = parsePayload(await statusHandlers.get("server_status")!({}));
    assert.equal(status.ok, true);
    assert.equal(status.server, "report-mcp");
    assert.equal(status.sessions.total, 1);
    assert.equal(status.sessions.ended, 1);
    assert.equal(status.graph.nodes, 1);

    const filtered = parsePayload(await helpHandlers.get("help_tools")!({ toolName: "get_graph" }));
    assert.equal(filtered.count, 1);
    assert.equal(filtered.tools[0].name, "get_graph");

    const missing = parsePayload(await helpHandlers.get("help_tools")!({ toolName: "missing_tool" }));
    assert.equal(missing.error, "Tool 'missing_tool' not found.");
  });

  test("get_graph returns the full graph payload", async () => {
    const deps = makeDeps();
    const handlers = captureTool(registerGetGraphTool, deps);

    const payload = parsePayload(await handlers.get("get_graph")!({}));
    assert.equal(payload.nodes.length, 1);
    assert.equal(payload.edges.length, 1);
    assert.equal(payload.sessions[0], "session-1");
  });

  test("get_report_weak_subjects validates selector input and returns follow-up payload", async () => {
    const deps = makeDeps();
    const handlers = captureTool(registerGetReportWeakSubjectsTool, deps);

    const missingSelector = parsePayload(await handlers.get("get_report_weak_subjects")!({
      weakScoreThreshold: 3,
      maxSubjects: 5,
    }));
    assert.equal(missingSelector.error, "Provide either sessionId or topic.");

    const payload = parsePayload(await handlers.get("get_report_weak_subjects")!({
      sessionId: "session-1",
      weakScoreThreshold: 3,
      maxSubjects: 5,
    }));
    assert.equal(payload.sessionId, "session-1");
    assert.equal(payload.questions.length, 1);
    assert.equal(payload.questions[0].strongAnswer, "TODO: max 3 lines");
    assert.equal(payload.nextTool, "generate_report_ui");
    assert.equal(payload.nextCall.arguments.questions[0].subject, "JWT claims");
  });

  test("get_report_full_context builds a full report payload and errors for active sessions", async () => {
    const activeSession = makeSession({ id: "active-1", state: "WAIT_FOR_ANSWER", endedAt: undefined });
    const deps = makeDeps({
      loadSessions: () => ({
        "session-1": makeSession(),
        "active-1": activeSession,
      }),
    });
    const handlers = captureTool(registerGetReportFullContextTool, deps);

    const activeResult = parsePayload(await handlers.get("get_report_full_context")!({
      sessionId: "active-1",
      weakScoreThreshold: 3,
    }));
    assert.equal(activeResult.error, "Session 'active-1' is not ended yet.");

    const payload = parsePayload(await handlers.get("get_report_full_context")!({
      topic: "JWT",
      weakScoreThreshold: 3,
    }));
    assert.equal(payload.topic, "JWT");
    assert.equal(payload.summary, "JWT interview summary");
    assert.equal(payload.weakSubjects.length, 1);
    assert.equal(payload.questions[0].questionNumber, 1);
  });

  test("get_progress_overview returns stateError when no ended sessions match and succeeds otherwise", async () => {
    const emptyDeps = makeDeps({
      buildProgressOverview: () => ({
        generatedAt: "2026-03-28T09:00:00.000Z",
        filters: { sessionKind: "interview" as const, weakScoreThreshold: 3, recentSessionsLimit: 5, topicLimit: 10 },
        totals: {
          sessions: 0,
          topics: 0,
          questionsAnswered: 0,
          avgScore: "N/A",
          weakQuestions: 0,
          weakQuestionRate: "0.0%",
          followUpCount: 0,
          followUpRate: "0.0%",
          firstSessionAt: null,
          lastSessionAt: null,
        },
        scoreDistribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
        scoreTrend: [],
        recentSessions: [],
        topicBreakdown: [],
        repeatedTopics: [],
      }),
    });
    const errorHandlers = captureTool(registerGetProgressOverviewTool, emptyDeps);
    const empty = parsePayload(await errorHandlers.get("get_progress_overview")!({
      sessionKind: "interview",
      weakScoreThreshold: 3,
      recentSessionsLimit: 5,
      topicLimit: 10,
    }));
    assert.equal(empty.error, "No ended sessions found for sessionKind='interview'.");

    const deps = makeDeps();
    const handlers = captureTool(registerGetProgressOverviewTool, deps);
    const payload = parsePayload(await handlers.get("get_progress_overview")!({
      sessionKind: "all",
      weakScoreThreshold: 3,
      recentSessionsLimit: 5,
      topicLimit: 10,
    }));
    assert.equal(payload.totals.sessions, 1);
    assert.equal(payload.topicBreakdown[0].topic, "JWT");
  });

  test("regenerate_report updates deeper dives when AI is enabled and saves the report", async () => {
    let savedSnapshot: Record<string, Session> | null = null;
    const deps = makeDeps({
      ai: {
        generateDeeperDives: async () => ["Explain issuer, audience, and expiration validation."],
      } as unknown as ToolDeps["ai"],
      saveSessions: (sessions) => {
        savedSnapshot = sessions;
      },
    });
    const handlers = captureTool(registerRegenerateReportTool, deps);

    const payload = parsePayload(await handlers.get("regenerate_report")!({ sessionId: "session-1" }));
    assert.equal(payload.sessionId, "session-1");
    assert.equal(payload.deeperDivesGenerated, 1);
    assert.ok(payload.reportFile.endsWith("session-1.md"));
    assert.equal(savedSnapshot!["session-1"]!.evaluations[0]?.deeperDive, "Explain issuer, audience, and expiration validation.");
  });

  test("generate_report_ui writes dataset/viewer files and stores strong answers", async () => {
    let storedSessions: Record<string, Session> | null = null;
    const deps = makeDeps({
      saveSessions: (sessions) => {
        storedSessions = sessions;
      },
    });
    const handlers = captureTool(registerGenerateReportUiTool, deps);

    const payload = parsePayload(await handlers.get("generate_report_ui")!({
      sessionId: "session-1",
      title: "Weak Questions Report - JWT",
      questions: [{
        questionNumber: 1,
        subject: "JWT claims",
        question: "Explain JWT validation.",
        candidateAnswer: "Check signature and claims.",
        interviewerFeedback: "Missed claim validation details.",
        strongAnswer: "Validate signature.\nCheck issuer.\nCheck expiration.",
        score: 2,
      }],
    }));

    assert.equal(payload.sessionId, "session-1");
    assert.ok(fs.existsSync(payload.datasetFile));
    assert.ok(fs.existsSync(payload.viewerFile));
    assert.match(payload.uiUrl, /report-ui\.html\?sessionId=session-1$/);

    const dataset = JSON.parse(fs.readFileSync(payload.datasetFile, "utf8"));
    assert.equal(dataset.questions[0].strongAnswer, "Validate signature.\nCheck issuer.\nCheck expiration.");
    assert.equal(storedSessions!["session-1"]!.evaluations[0]?.strongAnswer, "Validate signature.\nCheck issuer.\nCheck expiration.");
  });

  test("generate_report_ui rejects strong answers longer than three lines", async () => {
    const deps = makeDeps();
    const handlers = captureTool(registerGenerateReportUiTool, deps);

    const payload = parsePayload(await handlers.get("generate_report_ui")!({
      sessionId: "session-1",
      questions: [{
        questionNumber: 1,
        question: "Explain JWT validation.",
        candidateAnswer: "Check signature and claims.",
        interviewerFeedback: "Missed claim validation details.",
        strongAnswer: "line 1\nline 2\nline 3\nline 4",
      }],
    }));

    assert.equal(payload.error, "Strong answer for question 1 must be at most 3 lines.");
  });

  test("registerAllTools exposes every report-mcp tool name", () => {
    const deps = makeDeps();
    const handlers = captureTool(registerAllTools, deps);

    assert.deepEqual(
      [...handlers.keys()].sort(),
      [
        "generate_report_ui",
        "get_graph",
        "get_progress_overview",
        "get_report_full_context",
        "get_report_weak_subjects",
        "help_tools",
        "regenerate_report",
        "server_status",
      ]
    );
  });
});
