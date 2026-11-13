import { SAVE_RUN_AS_SKILL_LINE } from "./learn-request.ts";

export const TEACH_GOAL_CHARS = 300;

/** After saving, the bot explains the process back and then proves it with one demo run. */
export const TEACH_FOLLOW_UP =
  "Once the skill is saved, explain the whole process back to me in plain words, one short line per step. Then run the skill once now on that same computer as a demo, saying which step you are on as you go, and stop to ask me for anything marked hidden. If the skill is waiting for my review, explain it and wait for my decision before the demo.";

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
    `I did this myself on your computer (${input.desktop}) while it was recorded. Turn my steps into a skill you can run there on your own: find controls by their names rather than the screen positions, which are only hints, and ask me for anything marked hidden instead of guessing it.`,
    TEACH_FOLLOW_UP,
    "",
    ...steps.map((step, index) => `${index + 1}. ${step.summary}`),
    "",
    "",
  ].join("\n");
}
