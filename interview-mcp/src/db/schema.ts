import { relations } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  problemTitle: text("problem_title"),
  interviewType: text("interview_type"),
  sessionKind: text("session_kind"),
  studyCategory: text("study_category"),
  sourcePath: text("source_path"),
  sourceType: text("source_type"),
  seeded: integer("seeded", { mode: "boolean" }).notNull().default(false),
  customContent: text("custom_content"),
  focusArea: text("focus_area"),
  pendingAnswerMode: text("pending_answer_mode"),
  pendingResponseTimeLimitSec: integer("pending_response_time_limit_sec"),
  pendingResponseStartedAt: text("pending_response_started_at"),
  pendingAnswerElapsedSec: integer("pending_answer_elapsed_sec"),
  activeAdaptiveChallenge: text("active_adaptive_challenge"),
  state: text("state").notNull(),
  currentQuestionIndex: integer("current_question_index").notNull(),
  summary: text("summary"),
  knowledgeSource: text("knowledge_source").notNull(),
  createdAt: text("created_at").notNull(),
  endedAt: text("ended_at"),
  // Warm-up quest fields
  questLevel: integer("quest_level"),
  questFormat: text("quest_format"),
  questChoices: text("quest_choices"),   // JSON: string[][]
  questAnswers: text("quest_answers"),   // JSON: string[]
  algorithmLogged: integer("algorithm_logged", { mode: "boolean" }).default(false),
});

export const sessionQuestions = sqliteTable(
  "session_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    question: text("question").notNull(),
  },
  (table) => ({
    sessionPositionUnique: uniqueIndex("session_questions_session_position_idx").on(table.sessionId, table.position),
  })
);

export const sessionMessages = sqliteTable(
  "session_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    timestamp: text("timestamp").notNull(),
  },
  (table) => ({
    sessionPositionUnique: uniqueIndex("session_messages_session_position_idx").on(table.sessionId, table.position),
  })
);

export const sessionEvaluations = sqliteTable(
  "session_evaluations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    questionIndex: integer("question_index").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    answerMode: text("answer_mode"),
    answerElapsedSec: integer("answer_elapsed_sec"),
    responseTimeLimitSec: integer("response_time_limit_sec"),
    strongAnswer: text("strong_answer"),
    score: integer("score").notNull(),
    feedback: text("feedback").notNull(),
    needsFollowUp: integer("needs_follow_up", { mode: "boolean" }).notNull(),
    followUpQuestion: text("follow_up_question"),
    followUpType: text("follow_up_type"),
    followUpFocus: text("follow_up_focus"),
    followUpRationale: text("follow_up_rationale"),
    adaptiveChallengeType: text("adaptive_challenge_type"),
    adaptiveChallengePrompt: text("adaptive_challenge_prompt"),
    adaptiveChallengeGoal: text("adaptive_challenge_goal"),
    adaptiveChallengeReward: text("adaptive_challenge_reward"),
    deeperDive: text("deeper_dive"),
  },
  (table) => ({
    sessionPositionUnique: uniqueIndex("session_evaluations_session_position_idx").on(table.sessionId, table.position),
  })
);

export const sessionConcepts = sqliteTable("session_concepts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  word: text("word").notNull(),
  cluster: text("cluster").notNull(),
});

export const flashcards = sqliteTable("flashcards", {
  id: text("id").primaryKey(),
  front: text("front").notNull(),
  back: text("back").notNull(),
  topic: text("topic").notNull(),
  difficulty: text("difficulty").notNull(),
  createdAt: text("created_at").notNull(),
  dueDate: text("due_date").notNull(),
  interval: integer("interval").notNull(),
  easeFactor: real("ease_factor").notNull(),
  repetitions: integer("repetitions").notNull(),
  lastReviewedAt: text("last_reviewed_at"),
  archivedAt: text("archived_at"),
  sourceSessionId: text("source_session_id"),
  sourceQuestionIndex: integer("source_question_index"),
  sourceOriginalScore: integer("source_original_score"),
  title: text("title"),
  focusItem: text("focus_item"),
  studyNotes: text("study_notes"),
  // Lineage — set when evaluate_flashcard creates an improved replacement
  parentFlashcardId: text("parent_flashcard_id"),
  replacedByFlashcardId: text("replaced_by_flashcard_id"),
});

export const flashcardTags = sqliteTable(
  "flashcard_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    flashcardId: text("flashcard_id").notNull().references(() => flashcards.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => ({
    flashcardTagUnique: uniqueIndex("flashcard_tags_flashcard_tag_idx").on(table.flashcardId, table.tag),
  })
);

export const flashcardConcepts = sqliteTable(
  "flashcard_concepts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    flashcardId: text("flashcard_id").notNull().references(() => flashcards.id, { onDelete: "cascade" }),
    concept: text("concept").notNull(),
    position: integer("position").notNull(),
  },
  (table) => ({
    flashcardPositionUnique: uniqueIndex("flashcard_concepts_flashcard_position_idx").on(table.flashcardId, table.position),
  })
);

export const graphNodes = sqliteTable("graph_nodes", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
});

export const graphNodeClusters = sqliteTable(
  "graph_node_clusters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nodeId: text("node_id").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
    cluster: text("cluster").notNull(),
  },
  (table) => ({
    nodeClusterUnique: uniqueIndex("graph_node_clusters_node_cluster_idx").on(table.nodeId, table.cluster),
  })
);

export const graphEdges = sqliteTable(
  "graph_edges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
    target: text("target").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull(),
    kind: text("kind").notNull().default("cooccurrence"),
    relation: text("relation").notNull().default("co-occurs-with"),
  },
  (table) => ({
    sourceTargetUnique: uniqueIndex("graph_edges_source_target_kind_relation_idx").on(
      table.source,
      table.target,
      table.kind,
      table.relation
    ),
  })
);

export const graphSessions = sqliteTable("graph_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().unique().references(() => sessions.id, { onDelete: "cascade" }),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  confidence: integer("confidence").notNull().default(1),
  subSkills: text("sub_skills").notNull().default("[]"),   // JSON: SkillSubSkill[]
  relatedProblems: text("related_problems").notNull().default("[]"), // JSON: string[]
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const exercises = sqliteTable("exercises", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  topic: text("topic").notNull(),
  language: text("language").notNull().default("any"),
  difficulty: integer("difficulty").notNull().default(3),
  description: text("description").notNull(),
  scenario: text("scenario").notNull().default(""),
  problemMeaning: text("problem_meaning").notNull().default("[]"), // JSON: string[]
  tags: text("tags").notNull().default("[]"), // JSON: string[]
  prerequisites: text("prerequisites").notNull().default("[]"), // JSON: ExercisePrerequisite[]
  filePath: text("file_path").notNull(),
  createdAt: text("created_at").notNull(),
});

export const mistakes = sqliteTable("mistakes", {
  id: text("id").primaryKey(),
  mistake: text("mistake").notNull(),
  pattern: text("pattern").notNull(),
  fix: text("fix").notNull(),
  topic: text("topic"),
  createdAt: text("created_at").notNull(),
  // Flashcard answer linkage — set when created by evaluate_flashcard
  sourceAnswerId: text("source_answer_id"),
  sourceFlashcardId: text("source_flashcard_id"),
  replacementFlashcardId: text("replacement_flashcard_id"),
});

export const flashcardAnswers = sqliteTable("flashcard_answers", {
  id: text("id").primaryKey(),
  flashcardId: text("flashcard_id").notNull().references(() => flashcards.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  state: text("state").notNull().default("Pending"), // Pending | Evaluating | Completed
  smRating: integer("sm_rating"),                    // 1–4 user rating, stored for reference
  evaluatedAt: text("evaluated_at"),
  evaluationResult: text("evaluation_result"),       // LLM gap analysis text
  llmVerdict: text("llm_verdict"),                   // 'good_enough' | 'needs_improvement'
  mistakeId: text("mistake_id"),
  newFlashcardId: text("new_flashcard_id"),
  createdAt: text("created_at").notNull(),
});

export const topicPlans = sqliteTable("topic_plans", {
  topic: text("topic").primaryKey(),
  focused: integer("focused", { mode: "boolean" }).notNull().default(false),
  priority: text("priority").notNull().default("secondary"),
  updatedAt: text("updated_at").notNull(),
  lastLevelUpAt: text("last_level_up_at"),
  lastUnlockedLevel: integer("last_unlocked_level"),
});

export const codeChallenges = sqliteTable("code_challenges", {
  sessionId: text("session_id").primaryKey().references(() => sessions.id, { onDelete: "cascade" }),
  language: text("language").notNull(),
  functionSignature: text("function_signature").notNull(),
  starterCode: text("starter_code").notNull(),
  sampleTests: text("sample_tests").notNull().default("[]"),
  hints: text("hints").notNull().default("[]"),
  hiddenTestCount: integer("hidden_test_count").notNull().default(0),
  testHarness: text("test_harness").notNull(),
  referenceSolution: text("reference_solution").notNull(),
  teacherNotes: text("teacher_notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const algorithmProblems = sqliteTable("algorithm_problems", {
  id: text("id").primaryKey(),
  problem: text("problem").notNull(),
  problemDescription: text("problem_description").notNull().default(""),
  pattern: text("pattern").notNull().default(""),
  difficulty: text("difficulty").notNull().default("Medium"),
  trickyPart: text("tricky_part").notNull().default(""),
  mentalModel: text("mental_model").notNull().default(""),
  commonMistake: text("common_mistake").notNull().default(""),
  complexity: text("complexity").notNull().default(""),
  reSolvedWithoutHelp: integer("re_solved_without_help", { mode: "boolean" }).notNull().default(false),
  dateLastReviewed: text("date_last_reviewed"),
  nextReviewDays: integer("next_review_days").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge tables — derived from markdown files, seeded by seed script
// ─────────────────────────────────────────────────────────────────────────────

export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),           // slug, e.g. "jwt"
  category: text("category").notNull(),  // folder name, e.g. "security"
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const topicQuestions = sqliteTable("topic_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  text: text("text").notNull(),
  difficulty: text("difficulty").notNull(), // foundation | intermediate | advanced
  evaluationCriteria: text("evaluation_criteria").notNull(),
});

export const topicConcepts = sqliteTable("topic_concepts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  cluster: text("cluster").notNull(), // core concepts | practical usage | tradeoffs | best practices
  term: text("term").notNull(),
});

export const warmupQuestions = sqliteTable("warmup_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  level: integer("level").notNull().default(0),
  stem: text("stem").notNull(),
  choiceA: text("choice_a").notNull(),
  choiceB: text("choice_b").notNull(),
  choiceC: text("choice_c").notNull(),
  choiceD: text("choice_d").notNull(),
  correctAnswer: text("correct_answer").notNull(), // A | B | C | D
  weight: integer("weight").notNull().default(3),  // 1–5, higher = picked more often
  linkedQuestionOrder: integer("linked_question_order"), // nullable — open question this gates
});

export const warmupHistory = sqliteTable("warmup_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  warmupQuestionId: integer("warmup_question_id").notNull().references(() => warmupQuestions.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const topicsRelations = relations(topics, ({ many }) => ({
  questions: many(topicQuestions),
  concepts: many(topicConcepts),
  warmupQuestions: many(warmupQuestions),
}));

export const topicQuestionsRelations = relations(topicQuestions, ({ one }) => ({
  topic: one(topics, { fields: [topicQuestions.topicId], references: [topics.id] }),
}));

export const topicConceptsRelations = relations(topicConcepts, ({ one }) => ({
  topic: one(topics, { fields: [topicConcepts.topicId], references: [topics.id] }),
}));

export const warmupQuestionsRelations = relations(warmupQuestions, ({ one, many }) => ({
  topic: one(topics, { fields: [warmupQuestions.topicId], references: [topics.id] }),
  history: many(warmupHistory),
}));

export const warmupHistoryRelations = relations(warmupHistory, ({ one }) => ({
  question: one(warmupQuestions, { fields: [warmupHistory.warmupQuestionId], references: [warmupQuestions.id] }),
  session: one(sessions, { fields: [warmupHistory.sessionId], references: [sessions.id] }),
}));

export const sessionsRelations = relations(sessions, ({ many }) => ({
  questions: many(sessionQuestions),
  messages: many(sessionMessages),
  evaluations: many(sessionEvaluations),
  concepts: many(sessionConcepts),
  flashcards: many(flashcards),
}));

export const sessionQuestionsRelations = relations(sessionQuestions, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionQuestions.sessionId],
    references: [sessions.id],
  }),
}));

export const sessionMessagesRelations = relations(sessionMessages, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionMessages.sessionId],
    references: [sessions.id],
  }),
}));

export const sessionEvaluationsRelations = relations(sessionEvaluations, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionEvaluations.sessionId],
    references: [sessions.id],
  }),
}));

export const sessionConceptsRelations = relations(sessionConcepts, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionConcepts.sessionId],
    references: [sessions.id],
  }),
}));

export const flashcardsRelations = relations(flashcards, ({ one, many }) => ({
  session: one(sessions, {
    fields: [flashcards.sourceSessionId],
    references: [sessions.id],
  }),
  tags: many(flashcardTags),
  concepts: many(flashcardConcepts),
}));

export const flashcardTagsRelations = relations(flashcardTags, ({ one }) => ({
  flashcard: one(flashcards, {
    fields: [flashcardTags.flashcardId],
    references: [flashcards.id],
  }),
}));

export const flashcardConceptsRelations = relations(flashcardConcepts, ({ one }) => ({
  flashcard: one(flashcards, {
    fields: [flashcardConcepts.flashcardId],
    references: [flashcards.id],
  }),
}));

export const graphNodesRelations = relations(graphNodes, ({ many }) => ({
  clusters: many(graphNodeClusters),
}));

export const graphNodeClustersRelations = relations(graphNodeClusters, ({ one }) => ({
  node: one(graphNodes, {
    fields: [graphNodeClusters.nodeId],
    references: [graphNodes.id],
  }),
}));

export const flashcardAnswersRelations = relations(flashcardAnswers, ({ one }) => ({
  flashcard: one(flashcards, {
    fields: [flashcardAnswers.flashcardId],
    references: [flashcards.id],
  }),
}));
