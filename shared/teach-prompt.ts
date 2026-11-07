import { SAVE_RUN_AS_SKILL_LINE } from "./learn-request.ts";

export const TEACH_GOAL_CHARS = 300;

export interface TaughtStep {
  step: number;
  action: "start" | "click" | "type" | "key" | "scroll";
  summary: string;
  hidden?: true;
  image: string | null;
}

/** Opens with SAVE_RUN_AS_SKILL_LINE, so the server turns it into the same skill-authoring turn as `/learn`. */
export function teachPrompt(input: { goal?: string; desktop: string; steps: readonly TaughtStep[] }): string {
  const goal = (input.goal ?? "").replace(/\s+/gu, " ").trim().slice(0, TEACH_GOAL_CHARS);
  const steps = input.steps.filter((step) => step.action !== "start");
  return [
    SAVE_RUN_AS_SKILL_LINE,
    `Goal: ${goal || "the task I just showed you on your computer"}`,
    `I did this myself on your computer (${input.desktop}) while it was recorded. Turn my steps into a skill you can run there on your own: find controls by their names rather than the screen positions, which are only hints, and ask me for anything marked hidden instead of guessing it. Do not re-run the steps now.`,
    "",
    ...steps.map((step, index) => `${index + 1}. ${step.summary}`),
    "",
    "",
  ].join("\n");
}
