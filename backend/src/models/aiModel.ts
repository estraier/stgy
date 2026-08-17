export const AI_MODEL_TIERS = ["advanced", "balanced", "basic"] as const;

export type AIModelTier = (typeof AI_MODEL_TIERS)[number];

export function isAIModelTier(value: unknown): value is AIModelTier {
  return typeof value === "string" && (AI_MODEL_TIERS as readonly string[]).includes(value);
}

export type AIModel = {
  label: AIModelTier;
  service: string;
  chatModel: string;
};
