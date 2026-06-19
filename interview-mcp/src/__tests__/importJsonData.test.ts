import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { importLegacyJsonData } from "../import/legacyJson.js";
import type { AppRepositories } from "../repositories/index.js";
import type { Flashcard, KnowledgeGraph, Session } from "@mock-interview/shared";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "first-mcp-import-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeSession(id: string): Session {
  return {
    id,
    topic: "JWT authentication",
    state: "ENDED",
    currentQuestionIndex: 1,
    questions: ["What is JWT?"],
    messages: [],
    evaluations: [],
    createdAt: "2026-03-01T00:00:00.000Z",
    knowledgeSource: "ai",
  };
}

function makeFlashcard(sessionId: string): Flashcard {
  return {
    id: `fc-${sessionId}-q0`,
    front: "What is JWT?",
    back: "A token format used for signed claims.",
    topic: "JWT authentication",
    tags: ["jwt", "auth"],
    difficulty: "medium",
    source: {
      sessionId,
      questionIndex: 0,
      originalScore: 3,
    },
    createdAt: "2026-03-01T00:10:00.000Z",
    dueDate: "2026-03-01T00:10:00.000Z",
    interval: 1,
    easeFactor: 2.5,
    repetitions: 0,
  };
}

function makeGraph(sessionId: string): KnowledgeGraph {
  return {
    nodes: [{ id: "jwt", label: "JWT", clusters: ["core concepts"] }],
    edges: [],
    sessions: [sessionId],
  };
}

function createSpyRepositories() {
  const calls = {
    sessions: null as Record<string, Session> | null,
    flashcards: null as Flashcard[] | null,
    graph: null as KnowledgeGraph | null,
  };

  const repositories: AppRepositories = {
    sessions: {
      list: () => [],
      getById: () => null,
      save: () => undefined,
      saveMany: () => undefined,
      deleteById: () => false,
      replaceAll: (sessions) => {
        calls.sessions = sessions;
      },
    },
    flashcards: {
      list: () => [],
      listPaginated: () => ({ items: [], total: 0, hasMore: false, nextCursor: null }),
      getById: () => null,
      getChain: () => [],
      save: () => undefined,
      saveMany: () => undefined,
      deleteBySourceSessionId: () => 0,
      replaceAll: (flashcards) => {
        calls.flashcards = flashcards;
      },
    },
    graph: {
      get: () => ({ nodes: [], edges: [], sessions: [] }),
      save: (graph) => {
        calls.graph = graph;
      },
    },
    flashcardAnswers: {
      insert: () => undefined,
      getById: () => null,
      listByFlashcardId: () => [],
      listByState: () => [],
      updateState: () => undefined,
      update: () => undefined,
    },
    mistakes: {
      list: () => [],
      insert: () => undefined,
    },
    skills: {
      list: () => [],
      findByName: () => null,
      insert: () => undefined,
      update: () => undefined,
    },
    exercises: {
      list: () => [],
      findByName: () => null,
      findBySlug: () => null,
      insert: () => undefined,
    },
    topicPlans: {
      list: () => [],
      upsert: (plan) => plan,
    },
    codeChallenges: {
      getBySessionId: () => null,
      upsert: () => undefined,
    },
    algorithmProblems: {
      list: () => [],
      getById: () => null,
      getByProblem: () => null,
      insert: () => undefined,
      update: () => undefined,
      deleteById: () => false,
    },
  };

  return { repositories, calls };
}

describe("importLegacyJsonData", () => {
  test("imports legacy sessions, flashcards, and graph through repository boundaries", () => {
    const dataDir = makeTempDir();
    const session = makeSession("session-1");
    const flashcard = makeFlashcard(session.id);
    const graph = makeGraph(session.id);

    fs.writeFileSync(
      path.join(dataDir, "sessions.json"),
      JSON.stringify({ [session.id]: session }, null, 2)
    );
    fs.writeFileSync(
      path.join(dataDir, "flashcards.json"),
      JSON.stringify({ flashcards: [flashcard] }, null, 2)
    );
    fs.writeFileSync(
      path.join(dataDir, "graph.json"),
      JSON.stringify(graph, null, 2)
    );

    const { repositories, calls } = createSpyRepositories();
    const logs: string[] = [];

    const result = importLegacyJsonData({
      dataDir,
      repositories,
      fsLike: fs,
      logger: {
        log: (message: string) => logs.push(message),
        warn: () => undefined,
      },
    });

    assert.deepEqual(calls.sessions, {
      [session.id]: {
        ...session,
        interviewType: "design",
      },
    });
    assert.deepEqual(calls.flashcards, [flashcard]);
    assert.deepEqual(calls.graph, graph);
    assert.deepEqual(result, {
      sessionsImported: 1,
      flashcardsImported: 1,
      graphNodesImported: 1,
      graphEdgesImported: 0,
      graphSessionsImported: 1,
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /Legacy JSON import completed\./);
  });

  test("falls back to empty datasets when legacy files are missing", () => {
    const dataDir = makeTempDir();
    const { repositories, calls } = createSpyRepositories();

    const result = importLegacyJsonData({
      dataDir,
      repositories,
      fsLike: fs,
      logger: {
        log: () => undefined,
        warn: () => undefined,
      },
    });

    assert.deepEqual(calls.sessions, {});
    assert.deepEqual(calls.flashcards, []);
    assert.deepEqual(calls.graph, { nodes: [], edges: [], sessions: [] });
    assert.deepEqual(result, {
      sessionsImported: 0,
      flashcardsImported: 0,
      graphNodesImported: 0,
      graphEdgesImported: 0,
      graphSessionsImported: 0,
    });
  });

  test("normalizes legacy sessions that are missing knowledgeSource", () => {
    const dataDir = makeTempDir();
    const legacySession = {
      ...makeSession("session-legacy"),
      knowledgeSource: undefined,
      sourcePath: "data/knowledge/jwt.md",
    };
    delete (legacySession as Partial<Session>).knowledgeSource;

    fs.writeFileSync(
      path.join(dataDir, "sessions.json"),
      JSON.stringify({ [legacySession.id]: legacySession }, null, 2)
    );

    const { repositories, calls } = createSpyRepositories();

    const result = importLegacyJsonData({
      dataDir,
      repositories,
      fsLike: fs,
      logger: {
        log: () => undefined,
        warn: () => undefined,
      },
    });

    assert.equal(calls.sessions?.[legacySession.id].knowledgeSource, "file");
    assert.equal(calls.sessions?.[legacySession.id].interviewType, "design");
    assert.equal(result.sessionsImported, 1);
  });
});
