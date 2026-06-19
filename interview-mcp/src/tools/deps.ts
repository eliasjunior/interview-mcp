import type { AIProvider } from "../ai/index.js";
import type { KnowledgeStore } from "../knowledge/index.js";
import type { AlgorithmProblemTrackerItem, Concept, Evaluation, Exercise, Flashcard, FlashcardAnswer, KnowledgeGraph, Mistake, Skill, Session, TopicPlan } from "@mock-interview/shared";
import type { SessionDeletionPreview } from "../sessions/deleteFlow.js";
import type { StoredCodeChallenge } from "../repositories/codeChallengeRepository.js";

export type StateError = ReturnType<ToolDeps["stateError"]>;

export interface ToolDeps {
  ai: AIProvider | null;
  knowledge: KnowledgeStore;
  uiPort: string;

  stateError(msg: string): {
    content: Array<{ type: "text"; text: string }>;
  };

  loadSessions(): Record<string, Session>;
  saveSessions(sessions: Record<string, Session>): void;
  loadGraph(): KnowledgeGraph;
  saveGraph(graph: KnowledgeGraph): void;
  saveReport(session: Session): string;
  inspectSessionDeletion(sessionId: string): SessionDeletionPreview | null;
  deleteSessionById(sessionId: string): {
    preview: SessionDeletionPreview;
    deletedFlashcards: number;
    deletedArtifacts: string[];
    graph: { nodes: number; edges: number; sessions: number };
  } | null;
  loadFlashcards(): Flashcard[];
  saveFlashcard(card: Flashcard): void;
  saveFlashcards(cards: Flashcard[]): void;
  loadFlashcardAnswersByState(state: FlashcardAnswer["state"]): FlashcardAnswer[];
  saveFlashcardAnswer(answer: FlashcardAnswer): void;
  updateFlashcardAnswer(answer: FlashcardAnswer): void;
  loadMistakes(topic?: string): Mistake[];
  saveMistake(mistake: Mistake): void;
  loadSkills(maxConfidence?: number): Skill[];
  findSkillByName(name: string): Skill | null;
  saveSkill(skill: Skill): void;
  updateSkill(skill: Skill): void;
  findTopicPlan?(topic: string): TopicPlan | null;

  loadExercises(topic?: string, maxDifficulty?: number, tags?: string[]): Exercise[];
  findExerciseByName(name: string): Exercise | null;
  saveExercise(exercise: Exercise): void;
  getCodeChallenge?(sessionId: string): StoredCodeChallenge | null;
  saveCodeChallenge?(challenge: StoredCodeChallenge): void;
  exercisesDir: string;
  scopesDir: string;

  saveAlgorithmProblem(item: AlgorithmProblemTrackerItem): void;

  saveWarmupHistory(questionStem: string, topicTitle: string, sessionId: string, correct: boolean): void;

  loadWarmupStats(topicTitle: string, level: number): Array<{
    stem: string;
    weight: number;
    correctCount: number;
    incorrectCount: number;
  }>;

  generateId(): string;
  assertState(session: Session, toolName: string): { ok: true } | { ok: false; error: string };
  findLast<T>(arr: T[], pred: (item: T) => boolean): T | undefined;
  calcAvgScore(evaluations: Evaluation[]): string;
  buildSummary(session: Session): string;

  finalizeSession(
    session: Session,
    sessions: Record<string, Session>
  ): Promise<{ summary: string; avgScore: string; concepts: Concept[]; reportFile: string }>;
}
