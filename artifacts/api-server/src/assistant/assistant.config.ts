export const ASSISTANT_CONFIG = {
  // Feature Flags
  get isAssistantEnabled(): boolean {
    if (process.env.AI_ASSISTANT_ENABLED === "false") return false;
    return true;
  },
  get isVoiceEnabled(): boolean {
    // Strictly NOT_IMPLEMENTED in R41.A
    return false;
  },
  get isActionsEnabled(): boolean {
    // Strictly NOT_IMPLEMENTED for mutations in R41.A
    return false;
  },
  get isKillSwitchActive(): boolean {
    return process.env.AI_ASSISTANT_KILL_SWITCH === "true";
  },

  // Versioning
  promptVersion: "r41-a-1",
  knowledgeVersion: "arkpet-v32-r41",

  // Model & Provider defaults
  get defaultProvider(): string {
    return (process.env.AI_PROVIDER || "groq").toLowerCase();
  },
  get defaultModel(): string {
    if (process.env.AI_MODEL) return process.env.AI_MODEL;
    const provider = (process.env.AI_PROVIDER || "").toLowerCase();
    if (provider === "openai") return "gpt-4o-mini";
    return "openai/gpt-oss-20b";
  },
  requestTimeoutMs: 15000,
  maxSessionTurns: 30,

  // Rate Limiting
  rateLimitPerMinute: 60,
};

