export const STAGES = [
  { key: "want", label: "Want to make", hint: "Saved it, meaning to make it" },
  { key: "fabric", label: "Fabric bought", hint: "Materials in hand, not started" },
  { key: "in_progress", label: "In progress", hint: "On the table right now" },
  { key: "done", label: "Done", hint: "Made it" },
] as const;
export type Stage = (typeof STAGES)[number]["key"];
export const isStage = (s: unknown): s is Stage => STAGES.some((x) => x.key === s);
