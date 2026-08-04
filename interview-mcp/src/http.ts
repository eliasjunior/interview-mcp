import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import fs from "fs";
import { registerWeakReportRoutes } from "./http/weakReports.js";
import { applySM2 } from "./srsUtils.js";
import { buildSessionRewardSummary, detectTopicLevel, stabilizeTopicLevelSnapshot } from "./tools/getTopicLevel.js";
import { eq, count } from "drizzle-orm";
import { warmupQuestions } from "./db/schema.js";
import type {
  ReviewRating,
  Flashcard,
  FlashcardAnswer,
  Session,
  GraphInspectionResult,
  GraphInspectionSession,
  ProgressSessionKind,
  TopicPlan,
  TopicPlanPriority,
  AlgorithmProblemDifficulty,
  AlgorithmProblemTrackerItem,
} from "@mock-interview/shared";
import { randomUUID } from "crypto";
import { createDb } from "./db/client.js";
import { createSqliteRepositories } from "./db/repositories/createRepositories.js";
import { canonicalizeConceptWord } from "./graph/concepts.js";
import { deleteSessionWithArtifacts, inspectSessionDeletionImpact } from "./sessions/admin.js";
import { buildSessionLaunchPrompt } from "./sessions/launchPrompt.js";
import { buildProgressOverview } from "./progress.js";
import { createScopedInterviewSession, DEFAULT_FOCUS } from "./scopedInterview/session.js";
import {
  buildFlashcardHistory,
  DEFAULT_FLASHCARD_PAGE_SIZE,
  MAX_FLASHCARD_PAGE_SIZE,
  paginateFlashcards,
} from "./http/flashcards.js";
import {
  getKnowledgeTopicDetailsFromDb,
  listKnowledgeTopicsFromDb,
  normalizeTopicPlanKeyFromDb,
} from "./http/topicDetails.js";
import { inferLastLevelUpAt } from "./topicPlanProgress.js";
import { runCodeChallenge } from "./codeExecution/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const GENERATED_UI_DIR = path.join(PUBLIC_DIR, "generated");

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";
const db = createDb();
const repositories = createSqliteRepositories(db);

const app = express();
app.use(cors());
app.use(express.json());

// Serve the neural map frontend
app.use(express.static(PUBLIC_DIR));

function loadSessions(): Record<string, Session> {
  return Object.fromEntries(
    repositories.sessions.list().map((session) => [session.id, session])
  );
}

function hasWarmupContentForTopic(topic: string): boolean {
  const topicId = normalizeTopicPlanKeyFromDb(db, topic);
  const result = db.select({ n: count() }).from(warmupQuestions).where(eq(warmupQuestions.topicId, topicId)).get();
  return (result?.n ?? 0) > 0;
}

function getTopicDisplayName(topic: string): string {
  const normalizedTopic = normalizeTopicPlanKeyFromDb(db, topic);
  const topicEntry = listKnowledgeTopicsFromDb(db).find((entry) => entry.file === normalizedTopic);
  return topicEntry?.displayName ?? topic;
}

function repairTopicPlanLevelUpTimestamp(plan: TopicPlan): TopicPlan {
  if (plan.lastLevelUpAt || plan.lastUnlockedLevel === undefined) return plan;

  const inferredLastLevelUpAt = inferLastLevelUpAt({
    topic: getTopicDisplayName(plan.topic),
    sessions: loadSessions(),
    hasWarmupContent: hasWarmupContentForTopic(plan.topic),
  });

  if (!inferredLastLevelUpAt) return plan;

  return repositories.topicPlans.upsert({
    ...plan,
    lastLevelUpAt: inferredLastLevelUpAt,
  });
}

function loadFlashcards(): Flashcard[] {
  return repositories.flashcards.list();
}

function saveFlashcards(cards: Flashcard[]) {
  repositories.flashcards.replaceAll(cards);
}

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseProgressSessionKind(value: unknown): ProgressSessionKind {
  if (value === "interview" || value === "study" || value === "drill" || value === "warmup" || value === "all") {
    return value;
  }
  return "interview";
}

function parseAlgorithmProblemDifficulty(value: unknown, fallback: AlgorithmProblemDifficulty = "Medium"): AlgorithmProblemDifficulty {
  if (value === "Easy" || value === "Medium" || value === "Hard") return value;
  return fallback;
}

function parseAlgorithmProblemPatch(body: unknown, existing?: AlgorithmProblemTrackerItem) {
  const source = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const problem = typeof source.problem === "string" ? source.problem.trim() : existing?.problem ?? "";
  const nextReviewDaysRaw = source.nextReviewDays ?? existing?.nextReviewDays ?? 1;
  const nextReviewDays = Number.isFinite(Number(nextReviewDaysRaw))
    ? Math.max(0, Math.min(365, Math.trunc(Number(nextReviewDaysRaw))))
    : existing?.nextReviewDays ?? 1;
  const dateLastReviewed = Object.prototype.hasOwnProperty.call(source, "dateLastReviewed")
    ? typeof source.dateLastReviewed === "string" && source.dateLastReviewed.trim().length > 0
      ? source.dateLastReviewed.trim()
      : undefined
    : existing?.dateLastReviewed;

  return {
    problem,
    problemDescription: typeof source.problemDescription === "string"
      ? source.problemDescription.trim()
      : existing?.problemDescription ?? "",
    pattern: typeof source.pattern === "string" ? source.pattern.trim() : existing?.pattern ?? "",
    difficulty: parseAlgorithmProblemDifficulty(source.difficulty, existing?.difficulty ?? "Medium"),
    trickyPart: typeof source.trickyPart === "string" ? source.trickyPart.trim() : existing?.trickyPart ?? "",
    mentalModel: typeof source.mentalModel === "string" ? source.mentalModel.trim() : existing?.mentalModel ?? "",
    commonMistake: typeof source.commonMistake === "string" ? source.commonMistake.trim() : existing?.commonMistake ?? "",
    complexity: typeof source.complexity === "string" ? source.complexity.trim() : existing?.complexity ?? "",
    reSolvedWithoutHelp: typeof source.reSolvedWithoutHelp === "boolean"
      ? source.reSolvedWithoutHelp
      : existing?.reSolvedWithoutHelp ?? false,
    dateLastReviewed,
    nextReviewDays,
  };
}

function buildGraphInspection(selectedNodeIds: string[]): GraphInspectionResult {
  const graph = repositories.graph.get();
  const sessions = repositories.sessions.list();
  const selectedSet = new Set(selectedNodeIds);
  const selectedNodes = graph.nodes.filter((node) => selectedSet.has(node.id));
  const directEdges = graph.edges.filter(
    (edge) => selectedSet.has(edge.source) && selectedSet.has(edge.target)
  );

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const toInspectionSession = (session: Session): GraphInspectionSession => {
    const selectedConcepts = [...new Map(
      (session.concepts ?? [])
        .map((concept) => canonicalizeConceptWord(concept.word).id)
        .filter((id) => selectedSet.has(id))
        .map((id) => {
          const node = nodeById.get(id);
          return [id, {
            id,
            label: node?.label ?? id,
            clusters: node?.clusters ?? [],
          }];
        })
    ).values()];

    const prioritizedEvaluations = [...session.evaluations].sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const strongA = a.strongAnswer?.trim() ? 0 : 1;
      const strongB = b.strongAnswer?.trim() ? 0 : 1;
      if (strongA !== strongB) return strongA - strongB;
      return a.questionIndex - b.questionIndex;
    });

    const questionEvidence = session.evaluations.length > 0
      ? prioritizedEvaluations.slice(0, 3).map((evaluation) => ({
          questionIndex: evaluation.questionIndex,
          question: evaluation.question,
          answer: evaluation.answer,
          score: evaluation.score,
          feedback: evaluation.feedback,
          strongAnswer: evaluation.strongAnswer,
        }))
      : session.questions.slice(0, 3).map((question, index) => ({
          questionIndex: index,
          question,
        }));

    return {
      sessionId: session.id,
      topic: session.topic,
      createdAt: session.createdAt,
      selectedConcepts,
      questions: questionEvidence,
      summary: session.summary,
    };
  };

  const matchingSessions = sessions
    .map((session) => {
      const conceptIds = new Set((session.concepts ?? []).map((concept) => canonicalizeConceptWord(concept.word).id));
      const matchedIds = selectedNodeIds.filter((id) => conceptIds.has(id));
      return { session, matchedIds };
    })
    .filter(({ matchedIds }) => matchedIds.length > 0);

  const sessionsMatchingAll = matchingSessions
    .filter(({ matchedIds }) => matchedIds.length === selectedNodeIds.length)
    .map(({ session }) => toInspectionSession(session))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const sessionsMatchingAny = matchingSessions
    .filter(({ matchedIds }) => matchedIds.length < selectedNodeIds.length)
    .sort((a, b) => b.matchedIds.length - a.matchedIds.length || b.session.createdAt.localeCompare(a.session.createdAt))
    .map(({ session }) => toInspectionSession(session));

  return {
    selectedNodes,
    directEdges,
    sessionsMatchingAll,
    sessionsMatchingAny,
  };
}

// API: List available interview topics from knowledge files
app.get("/api/topics", (_req, res) => {
  res.json(listKnowledgeTopicsFromDb(db));
});

app.get("/api/topics/:topic/details", (req, res) => {
  const topic = decodeURIComponent(req.params.topic);
  const details = getKnowledgeTopicDetailsFromDb(db, topic);
  if (!details) {
    res.status(404).json({ error: "Topic not found" });
    return;
  }

  res.json(details);
});

// API: Get the recommended warm-up level for a topic
app.get("/api/topics/:topic/level", (req, res) => {
  const topic = decodeURIComponent(req.params.topic);
  const hasWarmupContent = hasWarmupContentForTopic(topic);

  const sessions = loadSessions();
  const persistedLevel = repositories.topicPlans
    .list()
    .find((plan) => normalizeTopicPlanKeyFromDb(db, plan.topic) === normalizeTopicPlanKeyFromDb(db, topic))
    ?.lastUnlockedLevel;
  const { level, status, reason, nextLevelRequirement, progress } = stabilizeTopicLevelSnapshot(
    detectTopicLevel(topic, sessions, hasWarmupContent),
    persistedLevel,
  );
  res.json({ topic, level, status, reason, nextLevelRequirement, hasWarmupContent, progress });
});

app.get("/api/topic-plans", (_req, res) => {
  res.json(
    repositories.topicPlans.list().map((plan) => {
      const repairedPlan = repairTopicPlanLevelUpTimestamp(plan);
      return {
        ...repairedPlan,
        topic: normalizeTopicPlanKeyFromDb(db, repairedPlan.topic),
      };
    })
  );
});

app.put("/api/topic-plans/:topic", (req, res) => {
  const topic = normalizeTopicPlanKeyFromDb(db, decodeURIComponent(req.params.topic));
  const focused = typeof req.body?.focused === "boolean" ? req.body.focused : false;
  const priority = req.body?.priority;
  const existingPlan = repositories.topicPlans.list().find((plan) => normalizeTopicPlanKeyFromDb(db, plan.topic) === topic);

  if (priority !== "core" && priority !== "secondary" && priority !== "optional") {
    res.status(400).json({ error: "priority must be one of: core, secondary, optional" });
    return;
  }

  res.json(repositories.topicPlans.upsert({
    topic,
    focused,
    priority: priority as TopicPlanPriority,
    updatedAt: new Date().toISOString(),
    lastLevelUpAt: existingPlan?.lastLevelUpAt,
    lastUnlockedLevel: existingPlan?.lastUnlockedLevel,
  }));
});

// API: Get the full knowledge graph
app.get("/api/graph", (_req, res) => {
  res.json(repositories.graph.get());
});

app.post("/api/graph/inspect", (req, res) => {
  const selectedNodeIds = Array.isArray(req.body?.nodeIds)
    ? req.body.nodeIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (selectedNodeIds.length === 0) {
    res.status(400).json({ error: "nodeIds must contain at least one node id" });
    return;
  }

  res.json(buildGraphInspection(Array.from(new Set(selectedNodeIds))));
});

app.get("/api/progress", (req, res) => {
  const progress = buildProgressOverview(loadSessions(), {
    sessionKind: parseProgressSessionKind(req.query.sessionKind),
    weakScoreThreshold: parseBoundedInt(req.query.weakScoreThreshold, 3, 1, 5),
    recentSessionsLimit: parseBoundedInt(req.query.recentSessionsLimit, 6, 1, 20),
    topicLimit: parseBoundedInt(req.query.topicLimit, 10, 1, 20),
  });

  res.json(progress);
});

app.get("/api/algorithm-problems", (_req, res) => {
  res.json(repositories.algorithmProblems.list());
});

app.post("/api/algorithm-problems", (req, res) => {
  const patch = parseAlgorithmProblemPatch(req.body);
  if (!patch.problem) {
    res.status(400).json({ error: "problem is required" });
    return;
  }

  const now = new Date().toISOString();
  const item: AlgorithmProblemTrackerItem = {
    id: randomUUID(),
    ...patch,
    createdAt: now,
    updatedAt: now,
  };

  repositories.algorithmProblems.insert(item);
  res.status(201).json(item);
});

app.put("/api/algorithm-problems/:id", (req, res) => {
  const existing = repositories.algorithmProblems.getById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Algorithm problem not found" });
    return;
  }

  const patch = parseAlgorithmProblemPatch(req.body, existing);
  if (!patch.problem) {
    res.status(400).json({ error: "problem is required" });
    return;
  }

  const item: AlgorithmProblemTrackerItem = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  repositories.algorithmProblems.update(item);
  res.json(item);
});

app.delete("/api/algorithm-problems/:id", (req, res) => {
  if (!repositories.algorithmProblems.deleteById(req.params.id)) {
    res.status(404).json({ error: "Algorithm problem not found" });
    return;
  }

  res.json({ deleted: true, id: req.params.id });
});

// API: List all sessions
app.get("/api/sessions", (_req, res) => {
  res.json(repositories.sessions.list());
});

app.post("/api/scoped-interviews", (req, res) => {
  const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
  const problemTitle = typeof req.body?.problemTitle === "string" && req.body.problemTitle.trim().length > 0
    ? req.body.problemTitle.trim()
    : undefined;
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  const focus = typeof req.body?.focus === "string" && req.body.focus.trim().length > 0
    ? req.body.focus.trim()
    : DEFAULT_FOCUS;
  const interviewType = req.body?.interviewType;

  if (!topic) {
    res.status(400).json({ error: "topic is required" });
    return;
  }

  const canStartTitleOnlyCodeInterview =
    interviewType === "code" && Boolean(problemTitle);

  if (content.length < 20 && !canStartTitleOnlyCodeInterview) {
    res.status(400).json({
      error: "content must be at least 20 characters unless a code interview has a problem title",
    });
    return;
  }

  if (interviewType !== undefined && interviewType !== "code" && interviewType !== "design") {
    res.status(400).json({ error: "interviewType must be one of: code, design" });
    return;
  }

  const result = createScopedInterviewSession({
    topic,
    problemTitle,
    rawContent: content,
    focus,
    interviewType,
    generateId: () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });

  repositories.sessions.save(result.session);

  res.status(201).json({
    sessionId: result.session.id,
    state: result.session.state,
    topic: result.session.topic,
    problemTitle: result.session.problemTitle ?? null,
    interviewType: result.session.interviewType,
    focusArea: result.focusArea,
    source: result.source,
    parsed: result.parsed,
    totalQuestions: result.totalQuestions,
    previewQuestions: result.previewQuestions,
    normalizedContent: result.normalizedContent,
    detectedContentType: result.detectedContentType,
    nextTool: result.detectedContentType === "algorithm"
      ? "configure_code_challenge"
      : "ask_question",
  });
});

app.get("/api/sessions/:id/reward-summary", (req, res) => {
  const session = repositories.sessions.list().find((candidate) => candidate.id === req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.state !== "ENDED") {
    res.status(409).json({ error: "Session is not finalized yet" });
    return;
  }

  const hasWarmupContent = hasWarmupContentForTopic(session.topic);
  res.json(buildSessionRewardSummary(session, loadSessions(), hasWarmupContent));
});

app.get("/api/sessions/:id/launch-prompt", (req, res) => {
  const session = repositories.sessions.getById(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(buildSessionLaunchPrompt(session));
});

app.get("/api/sessions/:id/code-challenge", (req, res) => {
  const challenge = repositories.codeChallenges.getBySessionId(req.params.id);
  if (!challenge) {
    res.status(404).json({ error: "Code challenge not configured" });
    return;
  }

  const {
    testHarness: _testHarness,
    referenceSolution: _referenceSolution,
    teacherNotes: _teacherNotes,
    ...publicChallenge
  } = challenge;
  res.json(publicChallenge);
});

app.post("/api/sessions/:id/code-runs", async (req, res) => {
  const challenge = repositories.codeChallenges.getBySessionId(req.params.id);
  if (!challenge) {
    res.status(404).json({ error: "Code challenge not configured" });
    return;
  }

  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code.trim()) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  try {
    res.json(await runCodeChallenge(challenge, code));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get("/api/sessions/:id/delete-preview", (req, res) => {
  const preview = inspectSessionDeletionImpact(repositories, req.params.id, {
    reportsDir: REPORTS_DIR,
    generatedUiDir: GENERATED_UI_DIR,
  });

  if (!preview) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(preview);
});

app.delete("/api/sessions/:id", (req, res) => {
  const result = deleteSessionWithArtifacts(repositories, req.params.id, {
    reportsDir: REPORTS_DIR,
    generatedUiDir: GENERATED_UI_DIR,
  });

  if (!result) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json({
    deleted: true,
    sessionId: req.params.id,
    ...result,
  });
});

// API: List all reports (id + topic + date)
app.get("/api/reports", (_req, res) => {
  if (!fs.existsSync(REPORTS_DIR)) {
    res.json([]);
    return;
  }
  const sessions = loadSessions();

  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith(".md"));
  const list = files.map(f => {
    const id = f.replace(".md", "");
    const session = sessions[id];
    return {
      id,
      topic: session?.topic ?? "Unknown",
      avgScore: session?.evaluations?.length
        ? (session.evaluations.reduce((s: number, e: { score: number }) => s + e.score, 0) / session.evaluations.length).toFixed(1)
        : "N/A",
      date: session?.createdAt ?? null,
      file: `/api/reports/${id}`,
    };
  });
  res.json(list);
});

// AI-backed deeper dives are intentionally disabled in this package.
app.get("/api/debug/deeper-dives/:id", (_req, res) => {
  res.status(410).json({
    ok: false,
    error: "Deeper-dive generation is no longer available because AI calls are disabled.",
  });
});

// API: Get a single report as Markdown
app.get("/api/reports/:id", (req, res) => {
  const reportPath = path.join(REPORTS_DIR, `${req.params.id}.md`);
  if (!fs.existsSync(reportPath)) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.type("text/markdown").send(fs.readFileSync(reportPath, "utf8"));
});

app.get("/api/sessions/:id/report-ui", (req, res) => {
  const session = repositories.sessions.getById(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const datasetPath = path.join(GENERATED_UI_DIR, `${req.params.id}-report-ui.json`);
  if (!fs.existsSync(datasetPath)) {
    res.json({
      ready: false,
      sessionId: session.id,
      state: session.state,
      message: session.state === "ENDED"
        ? "Report UI dataset has not been generated yet."
        : "Interview is still in progress. Report UI will be available after the interview is finished.",
    });
    return;
  }

  res.json({
    ready: true,
    sessionId: session.id,
    state: session.state,
    dataset: JSON.parse(fs.readFileSync(datasetPath, "utf8")),
  });
});

app.get("/api/mistakes", (req, res) => {
  const topic = typeof req.query.topic === "string" ? req.query.topic : undefined;
  res.json(repositories.mistakes.list(topic));
});

app.get("/api/flashcards", (req, res) => {
  const status = typeof req.query.status === "string"
    ? req.query.status
    : req.query.includeArchived === "true"
      ? "all"
      : "active";
  if (status !== "active" && status !== "archived" && status !== "all") {
    res.status(400).json({ error: "status must be one of: active, archived, all" });
    return;
  }

  const topic = typeof req.query.topic === "string" ? req.query.topic : undefined;
  const limit = parseBoundedInt(req.query.limit, DEFAULT_FLASHCARD_PAGE_SIZE, 1, MAX_FLASHCARD_PAGE_SIZE);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const cards = loadFlashcards();
  res.json(paginateFlashcards(cards, { status, topic, limit, cursor }));
});

app.get("/api/flashcards/:id/history", (req, res) => {
  const history = buildFlashcardHistory(loadFlashcards(), req.params.id);
  if (!history) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  res.json(history);
});

app.get("/api/flashcard-answers/pending", (_req, res) => {
  const cardsById = new Map(loadFlashcards().map((card) => [card.id, card]));
  const items = repositories.flashcardAnswers
    .listByState("Pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((answer) => {
      const card = cardsById.get(answer.flashcardId);
      return {
        ...answer,
        flashcard: card
          ? {
              id: card.id,
              topic: card.topic,
              front: card.front,
              back: card.back,
              difficulty: card.difficulty,
              archivedAt: card.archivedAt,
            }
          : null,
      };
    });

  res.json({ total: items.length, items });
});

app.post("/api/flashcards/:id/review", (req, res) => {
  const cards = loadFlashcards();
  const idx = cards.findIndex(c => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Card not found" }); return; }
  if (cards[idx]?.archivedAt) { res.status(409).json({ error: "Card is archived" }); return; }

  const rating = Number(req.body.rating) as ReviewRating;
  if (![1, 2, 3, 4].includes(rating)) { res.status(400).json({ error: "rating must be 1–4" }); return; }

  const srs = applySM2(cards[idx], rating);
  cards[idx] = { ...cards[idx], ...srs, lastReviewedAt: new Date().toISOString() };
  saveFlashcards(cards);
  res.json(cards[idx]);
});

app.post("/api/flashcards/:id/review-answer", (req, res) => {
  const flashcardId = req.params.id;
  const cards = loadFlashcards();
  const idx = cards.findIndex(c => c.id === flashcardId);
  if (idx === -1) { res.status(404).json({ error: "Card not found" }); return; }
  if (cards[idx]?.archivedAt) { res.status(409).json({ error: "Card is archived" }); return; }

  const rating = Number(req.body.rating) as ReviewRating;
  if (![1, 2, 3, 4].includes(rating)) { res.status(400).json({ error: "rating must be 1–4" }); return; }

  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
  if (!content) { res.status(400).json({ error: "content is required and must not be empty" }); return; }

  const answer: FlashcardAnswer = {
    id: randomUUID(),
    flashcardId,
    content,
    state: "Pending",
    smRating: rating,
    createdAt: new Date().toISOString(),
  };

  const srs = applySM2(cards[idx], rating);
  cards[idx] = { ...cards[idx], ...srs, lastReviewedAt: new Date().toISOString() };
  saveFlashcards(cards);
  repositories.flashcardAnswers.insert(answer);

  res.status(201).json({
    flashcard: cards[idx],
    answer,
  });
});

app.post("/api/flashcards/:id/archive", (req, res) => {
  const cards = loadFlashcards();
  const idx = cards.findIndex(c => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Card not found" }); return; }

  const archivedAt = cards[idx]?.archivedAt ?? new Date().toISOString();
  cards[idx] = { ...cards[idx], archivedAt };
  saveFlashcards(cards);
  res.json(cards[idx]);
});

app.post("/api/flashcards/:id/answers", (req, res) => {
  const flashcardId = req.params.id;
  const cards = loadFlashcards();
  const card = cards.find(c => c.id === flashcardId);
  if (!card) { res.status(404).json({ error: "Card not found" }); return; }
  if (card.archivedAt) { res.status(409).json({ error: "Card is archived" }); return; }

  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
  if (!content) { res.status(400).json({ error: "content is required and must not be empty" }); return; }

  const smRating = req.body.smRating != null ? Number(req.body.smRating) : undefined;
  if (smRating !== undefined && ![1, 2, 3, 4].includes(smRating)) {
    res.status(400).json({ error: "smRating must be 1–4" }); return;
  }

  const answer: FlashcardAnswer = {
    id: randomUUID(),
    flashcardId,
    content,
    state: "Pending",
    smRating: smRating as FlashcardAnswer["smRating"],
    createdAt: new Date().toISOString(),
  };

  repositories.flashcardAnswers.insert(answer);
  res.status(201).json(answer);
});

app.post("/api/flashcards/:id/unarchive", (req, res) => {
  const cards = loadFlashcards();
  const idx = cards.findIndex(c => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Card not found" }); return; }

  cards[idx] = { ...cards[idx], archivedAt: undefined };
  saveFlashcards(cards);
  res.json(cards[idx]);
});

registerWeakReportRoutes(app, {
  generatedUiDir: GENERATED_UI_DIR,
  loadSessions,
  fsLike: fs,
});

app.listen(PORT, HOST, () => {
  console.log(`Backend API ready`);
  console.log(`  Local:   http://localhost:${PORT}/api`);

  if (HOST === "0.0.0.0") {
    const networkAddresses = Object.values(os.networkInterfaces())
      .flatMap((interfaces) => interfaces ?? [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => address.address);

    for (const address of [...new Set(networkAddresses)]) {
      console.log(`  Network: http://${address}:${PORT}/api`);
    }
  }
});
