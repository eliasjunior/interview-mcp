import type { Session } from "@mock-interview/shared";

export interface SessionLaunchPrompt {
  sessionId: string;
  title: string;
  prompt: string;
  nextTool: "get_session";
}

function getModeLabel(session: Session): string {
  if (session.interviewType === "code") return "code interview";
  if (session.focusArea) return "scoped interview";
  return "interview";
}

function getSessionTitle(session: Session): string {
  if (session.problemTitle && session.problemTitle !== session.topic) {
    return `${session.topic} — ${session.problemTitle}`;
  }
  return session.topic;
}

export function buildSessionLaunchPrompt(session: Session): SessionLaunchPrompt {
  const action = session.state === "ENDED" ? "review" : "start or resume";
  const modeLabel = getModeLabel(session);
  const prompt = session.interviewType === "code"
    ? [
        `Please ${action} the code interview for session ${session.id}.`,
        "Call get_session first and continue from the exact stored state.",
        "This is an algorithm/coding interview. Do not turn it into API design, system design, production-readiness, observability, or authentication questions.",
        "If the executable challenge is not configured, call configure_code_challenge before presenting anything to the candidate.",
        "When configuring it, turn the problem title into a clear LeetCode-style statement with at least two basic input/output examples, explicit constraints, starter code in Java, progressive hints, a private reference solution in Java, and a private hidden-test harness.",
        "All code in this interview must be Java. Do not use JavaScript, Python, or any other language. Starter code, solutions, and examples must all be Java.",
        "Present the persisted problem statement and examples, ask the candidate to explain the approach and edge cases, then ask for working code or precise pseudocode.",
        "Give only light hints when needed and do not reveal the full solution.",
        "When the candidate submits code, call run_code. Ask them to diagnose failures before giving one hint at a time.",
        "If the implementation omits time and space complexity, ask for both before finishing.",
        "After a complete solution and complexity analysis, ask at most one useful problem-specific follow-up, then call end_interview.",
        "Follow the instruction field returned by get_session and do not expose evaluator criteria or tool chatter.",
      ].join(" ")
    : [
        `Please ${action} the ${modeLabel} for session ${session.id}.`,
        "Call get_session first, follow the instruction field if present, and continue from the current state.",
        "If the session is ready to begin, start with ask_question.",
        "When asking each question, ask the question first, then naturally offer three numbered answer styles so the candidate can reply with 1, 2, or 3.",
        "Do not ask the candidate to choose a mode before they see the question.",
        "Avoid mechanical UI-style wording like 'Answer modes:'. Prefer natural interviewer phrasing such as 'You can answer 1) Brief, 2) Bullets, or 3) Deep dive.'",
        "If ask_question returns responseTimeLimitSec, tell the candidate 'Take up to N seconds' in natural interviewer language. This is soft pressure only, not a hard cutoff.",
        "When you call submit_answer, always pass the chosen answerMode so evaluation stays fair for concise answers.",
        "After evaluate_answer, keep candidate-facing feedback mode-aware: for brief mode use at most 2-3 sentences plus one focused follow-up; for bullets mode keep the correction compact and structured; for deep_dive mode fuller explanation is fine.",
        "Do not expose tool chatter like tool counts or internal step labels to the candidate.",
      ].join(" ");

  return {
    sessionId: session.id,
    title: `${getSessionTitle(session)} — ${modeLabel}`,
    prompt,
    nextTool: "get_session",
  };
}
