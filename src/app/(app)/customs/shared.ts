import type { Tone } from "@/components/ui";

export const STATE_TONE: Record<string, Tone> = { overdue: "red", due_soon: "amber", upcoming: "slate", done: "green" };
export const STATE_LABEL: Record<string, string> = { overdue: "Overdue", due_soon: "Due < 48h", upcoming: "Upcoming", done: "Done" };

export function scoreTone(score: number): Tone {
  return score >= 90 ? "green" : score >= 60 ? "amber" : "red";
}
