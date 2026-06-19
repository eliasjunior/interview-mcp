import dotenv from "dotenv";
dotenv.config({ quiet: true });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type { AIProvider } from "./ai/index.js";
import { createKnowledgeStore, type KnowledgeStore } from "./knowledge/index.js";
import type { AlgorithmProblemTrackerItem, Session, Concept, KnowledgeGraph, Flashcard, FlashcardAnswer, Mistake, Skill, Exercise, WarmUpLevel } from "@mock-interview/shared";
import { assertState } from "./stateUtils.js";
import { generateId, findLast, calcAvgScore, buildSummary, buildReport, buildTranscript } from "./sessionUtils.js";
import { mergeConceptsIntoGraph } from "./graphUtils.js";
import { registerAllTools } from "./tools/registerAllTools.js";
import type { ToolDeps } from "./tools/deps.js";
import { detectTopicLevel } from "./tools/getTopicLevel.js";
import { createDb } from "./db/client.js";
import { createSqliteRepositories } from "./db/repositories/createRepositories.js";
import { and, eq, sql } from "drizzle-orm";
import { topics, warmupHistory, warmupQuestions } from "./db/schema.js";
import { normalizeConcepts } from "./graph/concepts.js";
import { deleteSessionWithArtifacts, inspectSessionDeletionImpact } from "./sessions/admin.js";
import { shouldRecordTopicLevelUp } from "./topicPlanProgress.js";
import { normalizeTopicPlanKeyFromDb } from "./http/topicDetails.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ai: AIProvider | null = null;

function stateError(msg: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
  };
}

const DATA_DIR = path.resolve(__dirname, "../data");
const REPORTS_DIR      = path.join(DATA_DIR, "reports");
const EXERCISES_DIR    = path.join(DATA_DIR, "knowledge", "exercises");
const SCOPES_DIR       = path.join(DATA_DIR, "knowledge", "scopes");
const PUBLIC_DIR       = path.resolve(__dirname, "../public");
const GENERATED_UI_DIR = path.join(PUBLIC_DIR, "generated");
const UI_PORT = process.env.PORT ?? "3001";
const db = createDb();
const knowledge: KnowledgeStore = createKnowledgeStore(db);
const repositories = createSqliteRepositories(db);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(EXERCISES_DIR)) fs.mkdirSync(EXERCISES_DIR, { recursive: true });
}


function loadSessions(): Record<string, Session> {
  return Object.fromEntries(
    repositories.sessions.list().map((session) => [session.id, session])
  );
}

function saveSessions(sessions: Record<string, Session>) {
  repositories.sessions.replaceAll(sessions);
}

function loadGraph(): KnowledgeGraph {
  return repositories.graph.get();
}

function saveGraph(graph: KnowledgeGraph) {
  repositories.graph.save(graph);
}

function loadFlashcards(): Flashcard[] {
  return repositories.flashcards.list();
}

function saveFlashcard(card: Flashcard) {
  repositories.flashcards.save(card);
}

function saveFlashcards(cards: Flashcard[]) {
  repositories.flashcards.replaceAll(cards);
}

function loadFlashcardAnswersByState(state: FlashcardAnswer["state"]): FlashcardAnswer[] {
  return repositories.flashcardAnswers.listByState(state);
}

function saveFlashcardAnswer(answer: FlashcardAnswer): void {
  repositories.flashcardAnswers.insert(answer);
}

function updateFlashcardAnswer(answer: FlashcardAnswer): void {
  repositories.flashcardAnswers.update(answer);
}

function loadMistakes(topic?: string): Mistake[] {
  return repositories.mistakes.list(topic);
}

function saveMistake(mistake: Mistake) {
  repositories.mistakes.insert(mistake);
}

function loadSkills(maxConfidence?: number): Skill[] {
  return repositories.skills.list(maxConfidence);
}

function findSkillByName(name: string): Skill | null {
  return repositories.skills.findByName(name);
}

function saveSkill(skill: Skill): void {
  repositories.skills.insert(skill);
}

function updateSkill(skill: Skill): void {
  repositories.skills.update(skill);
}

function loadExercises(topic?: string, maxDifficulty?: number, tags?: string[]): Exercise[] {
  return repositories.exercises.list(topic, maxDifficulty, tags);
}

function findExerciseByName(name: string): Exercise | null {
  return repositories.exercises.findByName(name);
}

function saveExercise(exercise: Exercise): void {
  repositories.exercises.insert(exercise);
}

function saveAlgorithmProblem(item: AlgorithmProblemTrackerItem): void {
  const existing = repositories.algorithmProblems.getByProblem(item.problem);
  if (existing) {
    repositories.algorithmProblems.update({ ...item, id: existing.id, createdAt: existing.createdAt });
  } else {
    repositories.algorithmProblems.insert(item);
  }
}

function findTopicPlan(topic: string) {
  const topicPlanKey = normalizeTopicPlanKeyFromDb(db, topic);
  return repositories.topicPlans
    .list()
    .find((plan) => plan.topic === topicPlanKey || plan.topic === topic) ?? null;
}

function saveReport(session: Session) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const filename = path.join(REPORTS_DIR, `${session.id}.md`);
  fs.writeFileSync(filename, buildReport(session));
  return filename;
}

function sessionArtifactPaths() {
  return {
    reportsDir: REPORTS_DIR,
    generatedUiDir: GENERATED_UI_DIR,
  };
}

function inspectSessionDeletion(sessionId: string) {
  return inspectSessionDeletionImpact(repositories, sessionId, sessionArtifactPaths());
}

function deleteSessionById(sessionId: string) {
  return deleteSessionWithArtifacts(repositories, sessionId, sessionArtifactPaths());
}

async function extractConcepts(session: Session): Promise<Concept[]> {
  const entry = knowledge.findByTopic(session.topic);
  if (entry && entry.concepts.length > 0) {
    console.error(`[knowledge] using pre-defined concepts for "${session.topic}"`);
    return entry.concepts;
  }
  if (ai) {
    return ai.extractConcepts(session.topic, buildTranscript(session));
  }
  console.error(`[knowledge] no concepts found for "${session.topic}" and AI is disabled — returning empty`);
  return [];
}

async function finalizeSession(session: Session, sessions: Record<string, Session>) {
  const previousSessions = Object.fromEntries(
    Object.entries(sessions).filter(([id]) => id !== session.id)
  );
  const topicId = normalizeTopicPlanKeyFromDb(db, session.topic);
  const warmupCount = db.select({ n: sql<number>`count(*)` }).from(warmupQuestions).where(eq(warmupQuestions.topicId, topicId)).get();
  const hasWarmupContent = (warmupCount?.n ?? 0) > 0;
  const previousLevelSnapshot = detectTopicLevel(session.topic, previousSessions, hasWarmupContent);

  const concepts = normalizeConcepts(await extractConcepts(session)).map(({ word, cluster }) => ({
    word,
    cluster,
  }));

  const summary = buildSummary(session);
  const avgScore = calcAvgScore(session.evaluations);

  session.state = "ENDED";
  session.summary = summary;
  session.concepts = concepts;
  session.endedAt = new Date().toISOString();
  saveSessions(sessions);

  const graph = loadGraph();
  saveGraph(mergeConceptsIntoGraph(graph, concepts, session.id));
  const reportFile = saveReport(session);

  const currentLevelSnapshot = detectTopicLevel(session.topic, sessions, hasWarmupContent);
  const topicPlanKey = normalizeTopicPlanKeyFromDb(db, session.topic);
  const existingTopicPlan = findTopicPlan(session.topic);
  const previousStoredLevel = existingTopicPlan?.lastUnlockedLevel;
  const currentStoredLevel = Math.max(previousStoredLevel ?? 0, currentLevelSnapshot.level) as WarmUpLevel;
  const leveledUp = shouldRecordTopicLevelUp({
    previousSnapshot: previousLevelSnapshot,
    currentSnapshot: currentLevelSnapshot,
    previousStoredLevel,
    currentStoredLevel,
  });
  repositories.topicPlans.upsert({
    topic: topicPlanKey,
    focused: existingTopicPlan?.focused ?? false,
    priority: existingTopicPlan?.priority ?? "secondary",
    updatedAt: new Date().toISOString(),
    lastLevelUpAt: leveledUp ? new Date().toISOString() : existingTopicPlan?.lastLevelUpAt,
    lastUnlockedLevel: currentStoredLevel,
  });

  return { summary, avgScore, concepts, reportFile };
}

const server = new McpServer({
  name: "interview-mcp",
  version: "0.2.0",
});

const deps: ToolDeps = {
  ai,
  knowledge,
  uiPort: UI_PORT,
  stateError,
  loadSessions,
  saveSessions,
  loadGraph,
  saveGraph,
  saveReport,
  inspectSessionDeletion,
  deleteSessionById,
  loadFlashcards,
  saveFlashcard,
  saveFlashcards,
  loadFlashcardAnswersByState,
  saveFlashcardAnswer,
  updateFlashcardAnswer,
  loadMistakes,
  saveMistake,
  loadSkills,
  findSkillByName,
  saveSkill,
  updateSkill,
  findTopicPlan,
  loadExercises,
  findExerciseByName,
  saveExercise,
  saveAlgorithmProblem,
  getCodeChallenge: (sessionId) => repositories.codeChallenges.getBySessionId(sessionId),
  saveCodeChallenge: (challenge) => repositories.codeChallenges.upsert(challenge),
  loadWarmupStats(topicTitle, level) {
    const topicRow = db.select({ id: topics.id }).from(topics).where(eq(topics.title, topicTitle)).get();
    if (!topicRow) return [];

    return db
      .select({
        stem: warmupQuestions.stem,
        weight: warmupQuestions.weight,
        correctCount: sql<number>`coalesce(sum(case when ${warmupHistory.correct} = 1 then 1 else 0 end), 0)`,
        incorrectCount: sql<number>`coalesce(sum(case when ${warmupHistory.correct} = 0 then 1 else 0 end), 0)`,
      })
      .from(warmupQuestions)
      .leftJoin(warmupHistory, eq(warmupHistory.warmupQuestionId, warmupQuestions.id))
      .where(and(eq(warmupQuestions.topicId, topicRow.id), eq(warmupQuestions.level, level)))
      .groupBy(warmupQuestions.id)
      .all();
  },
  saveWarmupHistory(questionStem, topicTitle, sessionId, correct) {
    const topicRow = db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.title, topicTitle))
      .get();
    if (!topicRow) return;
    const mcqRow = db
      .select({ id: warmupQuestions.id })
      .from(warmupQuestions)
      .where(and(eq(warmupQuestions.topicId, topicRow.id), eq(warmupQuestions.stem, questionStem)))
      .get();
    if (!mcqRow) return;
    db.insert(warmupHistory).values({
      warmupQuestionId: mcqRow.id,
      sessionId,
      correct,
      createdAt: new Date().toISOString(),
    }).run();
  },
  exercisesDir: EXERCISES_DIR,
  scopesDir: SCOPES_DIR,
  generateId,
  assertState,
  findLast,
  calcAvgScore,
  buildSummary,
  finalizeSession,
};

registerAllTools(server, deps);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("interview-mcp v0.2.0 — mode: knowledge files only — running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
