import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "./deps.js";
import { buildSessionRewardSummary } from "./getTopicLevel.js";
import { buildEndInterviewRecommendations } from "../sessionUtils.js";
import { buildFlashcardDrafts } from "../flashcardUtils.js";

export function registerEndInterviewTool(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    "end_interview",
    { description: "Force-end the interview at any point and generate a summary. Valid in any active state.", inputSchema: { sessionId: z.string() } },
    async ({ sessionId }) => {
      const sessions = deps.loadSessions();
      const session = sessions[sessionId];
      if (!session) return deps.stateError(`Session '${sessionId}' not found.`);
      if (session.state === "ENDED") return deps.stateError("Session is already ended.");

      // ── Warm-up round summary ────────────────────────────────────────────────
      if (session.sessionKind === "warmup") {
        await deps.finalizeSession(session, sessions);

        const level = session.questLevel ?? 0;
        const topic = session.topic;

        const correctEvals = session.evaluations.filter((e) => e.score >= 4);
        const wrongEvals   = session.evaluations.filter((e) => e.score < 4);
        const total        = session.evaluations.length;
        const correctCount = correctEvals.length;

        const weakSpots = wrongEvals.map((e) => e.question);

        // Count how many warmup rounds for this topic+level have now ended
        const allSessions = deps.loadSessions();
        const roundNumber = Object.values(allSessions).filter(
          (s) => s.topic === topic &&
                  s.sessionKind === "warmup" &&
                  (s.questLevel ?? 0) === level &&
                  s.state === "ENDED",
        ).length;

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              sessionId,
              sessionKind: "warmup",
              topic,
              level,
              roundNumber,
              score: { correct: correctCount, total, pct: total > 0 ? Math.round((correctCount / total) * 100) : 0 },
              weakSpots,
              canRepeat: true,
              instruction:
                `Present the round summary: ${correctCount}/${total} correct (${weakSpots.length > 0 ? `weak spots: ${weakSpots.join("; ")}` : "all correct!"}).` +
                " Then ask: 'Would you like another round of warm-up, or are you ready to start the interview?'" +
                ` Another round → start_warm_up { topic: "${topic}", level: ${level} }.` +
                ` Ready → start_interview { topic: "${topic}" }.` +
                " Wait for the candidate's answer before calling either tool.",
            }),
          }],
        };
      }

      // ── Code interview: require log_algorithm_problem before finalizing ────────
      if (session.interviewType === "code" && !session.algorithmLogged) {
        return deps.stateError(
          "Cannot end a code interview without logging the algorithm problem first. " +
          "Call log_algorithm_problem with the problem details and sessionId, then call end_interview again."
        );
      }

      // ── Full interview summary ───────────────────────────────────────────────
      const { summary, concepts, reportFile } = await deps.finalizeSession(session, sessions);
      const recommendations = buildEndInterviewRecommendations(session, deps.loadMistakes(session.topic));
      const flashcardDrafts = buildFlashcardDrafts(session);
      const knowledgeTopic = deps.knowledge.findByTopic(session.topic);
      const hasWarmupContent =
        knowledgeTopic != null &&
        knowledgeTopic.warmupLevels != null &&
        Object.keys(knowledgeTopic.warmupLevels).length > 0;
      const rewardSummary = buildSessionRewardSummary(session, deps.loadSessions(), hasWarmupContent);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            sessionId,
            state: session.state,
            summary,
            conceptsExtracted: concepts.length,
            reportFile,
            rewardSummary,
            recommendations,
            flashcards: {
              draftCount: flashcardDrafts.length,
              nextStep: flashcardDrafts.length > 0
                ? {
                    tool: "prepare_flashcards",
                    args: { sessionId },
                    hint: "Call prepare_flashcards to build the drafts, then present them to the user for confirmation before creating any card.",
                  }
                : null,
            },
            algorithmTracker: session.interviewType === "code"
              ? {
                  required: true,
                  hint: "This was a code interview. You MUST call log_algorithm_problem with the problem details before ending this session.",
                }
              : null,
          }),
        }],
      };
    }
  );
}
