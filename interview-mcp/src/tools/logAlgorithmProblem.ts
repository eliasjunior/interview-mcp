import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "./deps.js";

export function registerLogAlgorithmProblemTool(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    "log_algorithm_problem",
    {
      description:
        "Log or update an algorithm problem in the tracker after a code interview. Call this after end_interview when the session involved an algorithm/LeetCode-style problem.",
      inputSchema: {
        sessionId: z.string().optional().describe("Session ID of the code interview this problem came from. Required to unlock end_interview for that session."),
        problem: z.string().min(1).describe("Problem name, e.g. 'Two Sum'"),
        problemDescription: z.string().min(1).describe("Concise description of the problem in your own words"),
        pattern: z.enum([
          "Array / String",
          "Backtracking",
          "Binary Search",
          "Binary Tree",
          "Bit Manipulation",
          "Divide and Conquer",
          "Dynamic Programming",
          "Frequency Map",
          "Graph",
          "Greedy",
          "Hash Map",
          "Heap / Priority Queue",
          "Intervals",
          "Linked List",
          "Matrix",
          "Recursion",
          "Sliding Window",
          "Stack",
          "Trie",
          "Two Pointers",
        ]).describe("Algorithmic pattern — must be one of the canonical values"),
        difficulty: z.enum(["Easy", "Medium", "Hard"]).default("Medium").describe("LeetCode-style difficulty"),
        complexity: z.string().min(1).describe("Time and space complexity, e.g. 'O(n) time, O(n) space'"),
        trickyPart: z.string().default("").describe("What makes this problem tricky or non-obvious"),
        mentalModel: z.string().default("").describe("The mental model or key insight to solve it"),
        commonMistake: z.string().default("").describe("Common mistake to avoid"),
        reSolvedWithoutHelp: z.boolean().default(false).describe("Whether the candidate solved it without hints"),
        dateLastReviewed: z.string().optional().describe("ISO date string, defaults to today"),
        nextReviewDays: z.number().int().min(0).default(1).describe("Days until next review"),
      },
    },
    async ({
      sessionId,
      problem,
      problemDescription,
      pattern,
      difficulty,
      complexity,
      trickyPart,
      mentalModel,
      commonMistake,
      reSolvedWithoutHelp,
      dateLastReviewed,
      nextReviewDays,
    }) => {
      const now = new Date().toISOString();
      const item = {
        id: deps.generateId(),
        sessionId,
        problem,
        problemDescription,
        pattern,
        difficulty,
        complexity,
        trickyPart,
        mentalModel,
        commonMistake,
        reSolvedWithoutHelp,
        dateLastReviewed: dateLastReviewed ?? now.slice(0, 10),
        nextReviewDays,
        createdAt: now,
        updatedAt: now,
      };
      deps.saveAlgorithmProblem(item);

      if (sessionId) {
        const sessions = deps.loadSessions();
        const session = sessions[sessionId];
        if (session) {
          session.algorithmLogged = true;
          deps.saveSessions(sessions);
        }
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ logged: true, id: item.id, problem: item.problem }),
          },
        ],
      };
    }
  );
}
