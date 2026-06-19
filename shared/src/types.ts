// ─────────────────────────────────────────────────────────────────────────────
// @mock-interview/shared — single source of truth for all domain types
//
// Used by: interview-mcp  report-mcp  ui
// Never duplicate these — import from this package instead.
// ─────────────────────────────────────────────────────────────────────────────

// ── Interview state machine ───────────────────────────────────────────────────

export type InterviewState =
  | 'ASK_QUESTION'
  | 'WAIT_FOR_ANSWER'
  | 'EVALUATE_ANSWER'
  | 'FOLLOW_UP'
  | 'ENDED'

export type SessionKind = 'interview' | 'study' | 'drill' | 'warmup'
/** @deprecated Use interviewType to distinguish design vs code sessions. */
export type StudyCategory = 'topic' | 'algorithm'
export type InterviewType = 'design' | 'code'
export type AnswerMode = 'brief' | 'bullets' | 'deep_dive'
export type FollowUpType =
  | 'missing_concept'
  | 'vague_tradeoff'
  | 'no_example'
  | 'shallow_failure_mode'
  | 'code_complexity'
  | 'problem_aware'
  | 'generic'
export type AdaptiveChallengeType = 'recovery_round' | 'twist_round'
export type AdaptiveChallengeStatus = 'pending' | 'asked'

export interface ActiveAdaptiveChallenge {
  type: AdaptiveChallengeType
  status: AdaptiveChallengeStatus
  sourceQuestionIndex: number
  prompt: string
  goal?: string
  reward?: string
}

// ── Warm-up quest levels ───────────────────────────────────────────────────────

/** Topic progression level. 0–2 = warm-up ladder, 3 = mock-ready, 4 = sustained real-interview readiness. */
export type WarmUpLevel = 0 | 1 | 2 | 3 | 4
export type TopicStatus = 'cold' | 'warmup' | 'dropped' | 'ready'
export type TopicProgressVariant = 'warmup' | 'interview' | 'complete'

export interface TopicLevelProgressData {
  current: number
  required: number
  targetLevel: WarmUpLevel
  variant: TopicProgressVariant
  label: string
  attempted: boolean
  almostThere: boolean
}

export interface TopicLevelSnapshot {
  level: WarmUpLevel
  status: TopicStatus
  reason: string
  nextLevelRequirement: string
  progress: TopicLevelProgressData
}

export interface SessionRewardSummary {
  sessionId: string
  topic: string
  eligible: boolean
  state: 'level_up' | 'progress' | 'stalled' | 'complete' | 'ineligible'
  previous: TopicLevelSnapshot
  current: TopicLevelSnapshot
  title: string
  message: string
  nextHint?: string
  whyNoProgress?: string
}

export type TopicPlanPriority = 'core' | 'secondary' | 'optional'

export interface TopicPlan {
  topic: string
  focused: boolean
  priority: TopicPlanPriority
  updatedAt: string
  lastLevelUpAt?: string
  lastUnlockedLevel?: WarmUpLevel
}

/** Question format used in warm-up sessions. */
export type QuestionFormat = 'mcq' | 'fill_blank' | 'guided' | 'open'

// ── Session data ──────────────────────────────────────────────────────────────

export interface Message {
  role: 'interviewer' | 'candidate'
  content: string
  timestamp: string
}

export interface Evaluation {
  questionIndex: number
  question: string
  answer: string
  answerMode?: AnswerMode
  answerElapsedSec?: number
  responseTimeLimitSec?: number
  strongAnswer?: string
  score: number           // 1–5
  feedback: string
  needsFollowUp: boolean
  followUpQuestion?: string
  followUpType?: FollowUpType
  followUpFocus?: string
  followUpRationale?: string
  adaptiveChallengeType?: AdaptiveChallengeType
  adaptiveChallengePrompt?: string
  adaptiveChallengeGoal?: string
  adaptiveChallengeReward?: string
  deeperDive?: string     // markdown bullets: "where to go deeper"
}

export interface Concept {
  word: string
  cluster: string
}

export interface Session {
  id: string
  topic: string
  /** Optional narrower problem label within the broader topic/category, e.g. topic="Linked Lists", problemTitle="Delete Middle Node". */
  problemTitle?: string
  /** Interview type — 'design' (default) or 'code' (future). Absent on legacy sessions → treat as 'design'. */
  interviewType?: InterviewType
  sessionKind?: SessionKind
  /** @deprecated Use interviewType to distinguish design vs code sessions. */
  studyCategory?: StudyCategory
  sourcePath?: string
  sourceType?: 'markdown' | 'java'
  seeded?: boolean
  /** Raw content/spec passed to start_scoped_interview — used as rubric context during evaluation */
  customContent?: string
  /** The interview angle for a scoped session, e.g. "robustness, reliability, and extensibility" */
  focusArea?: string
  /** Answer mode for the currently submitted answer awaiting evaluation. */
  pendingAnswerMode?: AnswerMode
  /** Suggested timer for the currently active question. */
  pendingResponseTimeLimitSec?: number
  /** When the current question timer started. */
  pendingResponseStartedAt?: string
  /** Candidate answer latency for the current answer awaiting evaluation. */
  pendingAnswerElapsedSec?: number
  /** Active adaptive challenge that must be handled before advancing. */
  activeAdaptiveChallenge?: ActiveAdaptiveChallenge
  /** Warm-up quest level recorded on warm-up sessions. In practice warm-up sessions use 0–2 only. */
  questLevel?: WarmUpLevel
  /** Question format used in this warm-up session. */
  questFormat?: QuestionFormat
  /** MCQ answer choices, parallel to questions[]. Only present when questFormat === 'mcq'. */
  questChoices?: string[][]
  /** Correct answers for auto-evaluation (L0/L1). Parallel to questions[]. */
  questAnswers?: string[]
  state: InterviewState
  currentQuestionIndex: number
  questions: string[]
  /**
   * Evaluation criteria parallel to `questions` — populated when questions are
   * selected from a knowledge file with difficulty-based sampling. Avoids
   * re-indexing into the original file when questions are shuffled.
   */
  questionCriteria?: string[]
  messages: Message[]
  evaluations: Evaluation[]
  summary?: string
  concepts?: Concept[]
  createdAt: string
  endedAt?: string
  /** "file" = questions came from data/knowledge/, "ai" = generated by AI provider */
  knowledgeSource: 'file' | 'ai'
  /** Set to true once log_algorithm_problem has been called for this session. Required before end_interview finalizes a code interview. */
  algorithmLogged?: boolean
}

// ── Executable code challenges ───────────────────────────────────────────────

export type CodeChallengeLanguage = 'javascript' | 'java'

export interface CodeChallenge {
  sessionId: string
  language: CodeChallengeLanguage
  functionSignature: string
  starterCode: string
  sampleTests: string[]
  hints: string[]
  hiddenTestCount: number
  createdAt: string
  updatedAt: string
}

export interface CodeRunResult {
  ok: boolean
  phase: 'compile' | 'test'
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
}

// ── Knowledge graph ───────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  label: string
  clusters: string[]
}

export type GraphEdgeKind = 'cooccurrence' | 'semantic'

export interface GraphEdge {
  source: string
  target: string
  weight: number
  kind: GraphEdgeKind
  relation: string
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  sessions: string[]
}

export interface GraphInspectionQuestion {
  questionIndex: number
  question: string
  answer?: string
  score?: number
  feedback?: string
  strongAnswer?: string
}

export interface GraphInspectionSession {
  sessionId: string
  topic: string
  createdAt: string
  selectedConcepts: Array<{
    id: string
    label: string
    clusters: string[]
  }>
  questions: GraphInspectionQuestion[]
  summary?: string
}

export interface GraphInspectionResult {
  selectedNodes: GraphNode[]
  directEdges: GraphEdge[]
  sessionsMatchingAll: GraphInspectionSession[]
  sessionsMatchingAny: GraphInspectionSession[]
}

// ── Algorithm problem tracker ────────────────────────────────────────────────

export type AlgorithmProblemDifficulty = 'Easy' | 'Medium' | 'Hard'

export interface AlgorithmProblemTrackerItem {
  id: string
  problem: string
  /** Original exercise prompt context, written in our own concise words. */
  problemDescription: string
  pattern: string
  difficulty: AlgorithmProblemDifficulty
  trickyPart: string
  mentalModel: string
  commonMistake: string
  complexity: string
  reSolvedWithoutHelp: boolean
  dateLastReviewed?: string
  nextReviewDays: number
  createdAt: string
  updatedAt: string
  /** Session that originated this log entry. Used to mark session.algorithmLogged = true. */
  sessionId?: string
}

// ── AI provider ───────────────────────────────────────────────────────────────

export interface EvaluationResult {
  score: number           // 1–5
  feedback: string        // one sentence, specific and actionable
  strongAnswer?: string
  needsFollowUp: boolean
  followUpQuestion?: string
  deeperDive?: string
}

// ── Flashcards ────────────────────────────────────────────────────────────────

export type FlashcardDifficulty = 'easy' | 'medium' | 'hard'

export interface Flashcard {
  id: string
  /** The question or concept prompt shown to the user */
  front: string
  /** Rich explanation: correct answer, key points, common pitfalls */
  back: string
  topic: string
  tags: string[]
  difficulty: FlashcardDifficulty
  /** Where the card came from — absent for manually created cards */
  source?: {
    sessionId: string
    questionIndex: number
    originalScore: number   // the score that triggered creation (< 4)
  }
  createdAt: string

  // ── Spaced repetition (SM-2) ────────────────────────────────────────────────
  /** ISO date string — when the card is next due for review */
  dueDate: string
  /** Current interval in days between reviews */
  interval: number
  /** SM-2 ease factor — starts at 2.5, adjusted by review rating */
  easeFactor: number
  /** How many times reviewed successfully in a row */
  repetitions: number
  lastReviewedAt?: string
  /** When set, the card is archived and should no longer appear in active review flows */
  archivedAt?: string

  // ── Flashcard lineage ───────────────────────────────────────────────────────
  /** ID of the card this was derived from (set when evaluate_flashcard creates an improved card) */
  parentFlashcardId?: string
  /** ID of the card that replaced this one (set when this card is superseded) */
  replacedByFlashcardId?: string
}

// ── Flashcard answers ─────────────────────────────────────────────────────────

export type AnswerState = 'Pending' | 'Evaluating' | 'Completed'
export type FlashcardAnswerVerdict = 'good_enough' | 'needs_improvement'

export interface FlashcardAnswer {
  id: string
  flashcardId: string
  /** The raw answer the user typed before flipping the card */
  content: string
  state: AnswerState
  /** SM-2 rating the user gave (1–4), stored for reference */
  smRating?: ReviewRating
  /** When the LLM evaluated this answer */
  evaluatedAt?: string
  /** LLM's gap analysis text */
  evaluationResult?: string
  /** Whether the answer was good enough or needs improvement */
  llmVerdict?: FlashcardAnswerVerdict
  /** FK to the mistake created (if needs_improvement) */
  mistakeId?: string
  /** FK to the replacement flashcard created (if needs_improvement) */
  newFlashcardId?: string
  createdAt: string
}

/** Rating passed to review_flashcard — mirrors SM-2 quality 1–4 */
export type ReviewRating = 1 | 2 | 3 | 4

// ── Flashcard list / history API shapes ──────────────────────────────────────

export type FlashcardListStatus = 'active' | 'archived' | 'all'

export interface FlashcardListResponse {
  items: Flashcard[]
  total: number
  hasMore: boolean
  /** Opaque cursor — pass back as `cursor` param to get the next page */
  nextCursor: string | null
}

export interface FlashcardHistoryResponse {
  /** ID of the card that was requested */
  selectedId: string
  /** Whether the chain has more than one version */
  hasHistory: boolean
  /** Full lineage chain ordered oldest → newest */
  items: Flashcard[]
}

export interface FlashcardReviewResult {
  cardId: string
  rating: ReviewRating
  nextDueDate: string
  nextInterval: number
  nextEaseFactor: number
}

// ── Skill backlog ─────────────────────────────────────────────────────────────

export interface SkillSubSkill {
  name: string
  /** Confidence 1–5 on this specific sub-skill */
  confidence: number
}

export interface Skill {
  id: string
  /** Transferable skill name, e.g. "2D index transformations" */
  name: string
  /** Overall confidence 1–5 */
  confidence: number
  /** Atomic sub-skills within this skill, each with its own confidence */
  subSkills: SkillSubSkill[]
  /** Problems where this skill appears, e.g. ["rotate matrix", "spiral matrix"] */
  relatedProblems: string[]
  createdAt: string
  updatedAt: string
}

// ── Mistake log ───────────────────────────────────────────────────────────────

export interface Mistake {
  id: string
  /** What went wrong */
  mistake: string
  /** When / in what context it happens */
  pattern: string
  /** The correct approach or fix */
  fix: string
  /** Optional topic tag (e.g. "Java Thread States") */
  topic?: string
  createdAt: string

  // ── Flashcard answer linkage (set when created by evaluate_flashcard) ────────
  /** FK to the FlashcardAnswer that triggered this mistake */
  sourceAnswerId?: string
  /** FK to the original flashcard that was answered */
  sourceFlashcardId?: string
  /** FK to the improved flashcard created as a replacement */
  replacementFlashcardId?: string
}

// ── Exercises ─────────────────────────────────────────────────────────────────

export type ExerciseDifficulty = 1 | 2 | 3 | 4 | 5

export interface ExercisePrerequisite {
  name: string
  reason: string
}

export interface Exercise {
  id: string
  /** Display name, e.g. "RaceConditionLab" */
  name: string
  /** Slug derived from name, used as filename, e.g. "race-condition-lab" */
  slug: string
  /** Knowledge topic this exercise belongs to, e.g. "java-concurrency" */
  topic: string
  /** Programming language or "any" */
  language: string
  /** 1 (trivial) → 5 (very hard) */
  difficulty: ExerciseDifficulty
  /** One-line summary of what the exercise practices */
  description: string
  /** Real-world system context, e.g. "Background email/job processing system" */
  scenario: string
  /** Why this matters in production — the problem it actually solves */
  problemMeaning: string[]
  /** Cross-topic grouping labels, e.g. ["matrix", "2d-indexing", "array-traversal"] */
  tags: string[]
  /** Exercises that should be completed before this one */
  prerequisites: ExercisePrerequisite[]
  /** Path to the .md file relative to data/knowledge/exercises/ */
  filePath: string
  createdAt: string
}

// ── Progress reporting ─────────────────────────────────────────────────────────

export type ProgressSessionKind = SessionKind | 'all'

export interface ProgressOverviewFilters {
  sessionKind: ProgressSessionKind
  weakScoreThreshold: number
  recentSessionsLimit: number
  topicLimit: number
}

export interface ProgressOverviewTotals {
  sessions: number
  topics: number
  questionsAnswered: number
  avgScore: string
  weakQuestions: number
  weakQuestionRate: string
  followUpCount: number
  followUpRate: string
  firstSessionAt: string | null
  lastSessionAt: string | null
}

export interface ProgressRecentSession {
  sessionId: string
  topic: string
  sessionKind: SessionKind
  createdAt: string
  endedAt?: string
  avgScore: string
  questionCount: number
  weakQuestionCount: number
  followUpCount: number
}

export interface ProgressTrendPoint {
  sessionId: string
  topic: string
  endedAt: string
  avgScore: string
}

export interface ProgressTopicBreakdown {
  topic: string
  sessionCount: number
  avgScore: string
  latestScore: string
  deltaFromFirst: string
  totalQuestions: number
  weakQuestions: number
  weakQuestionRate: string
  lastSessionAt: string
}

export interface ProgressRepeatedTopic {
  topic: string
  sessionCount: number
  firstScore: string
  latestScore: string
  delta: string
  firstSessionAt: string
  latestSessionAt: string
}

export interface ProgressOverview {
  generatedAt: string
  filters: ProgressOverviewFilters
  totals: ProgressOverviewTotals
  scoreDistribution: Record<'1' | '2' | '3' | '4' | '5', number>
  recentSessions: ProgressRecentSession[]
  scoreTrend: ProgressTrendPoint[]
  topicBreakdown: ProgressTopicBreakdown[]
  repeatedTopics: ProgressRepeatedTopic[]
}

// ── HTTP API responses (used by ui) ───────────────────────────────────────────

export interface ReportMeta {
  id: string
  topic: string
  avgScore: string
  date: string | null
  file: string
}

export interface SessionDeletionPreview {
  session: {
    id: string
    topic: string
    state: string
    createdAt: string
    endedAt: string | null
    questionCount: number
    messageCount: number
    evaluationCount: number
    conceptCount: number
    hasSummary: boolean
  }
  flashcards: {
    count: number
    ids: string[]
  }
  graph: {
    includedInGraphSessions: boolean
    rebuildRequired: boolean
    currentNodeCount: number
    currentEdgeCount: number
  }
  artifacts: {
    markdownReport: boolean
    reportUiDataset: boolean
    weakSubjectsHtml: boolean
  }
  warnings: string[]
}

export interface SessionDeleteResult {
  deleted: true
  sessionId: string
  preview: SessionDeletionPreview
  deletedFlashcards: number
  deletedArtifacts: string[]
  graph: {
    nodes: number
    edges: number
    sessions: number
  }
}
