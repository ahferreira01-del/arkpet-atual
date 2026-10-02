export const ASSISTANT_CONFIG = {
  // Feature Flags
  get isAssistantEnabled(): boolean {
    if (process.env.AI_ASSISTANT_ENABLED === "false") return false;
    return true;
  },
  get isVoiceEnabled(): boolean {
    // Strictly NOT_IMPLEMENTED in R41.C (Reserved for R41.D)
    return false;
  },
  get isActionsEnabled(): boolean {
    // Strictly NOT_IMPLEMENTED for domain mutations in R41.C (Reserved for R41.E)
    return false;
  },
  get isKillSwitchActive(): boolean {
    return process.env.AI_ASSISTANT_KILL_SWITCH === "true";
  },

  // Versioning
  promptVersion: "r41-c-1",
  knowledgeVersion: "arkpet-v32-r41c",

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

  // Guidance Route Allowlist (ARBITRARY_NAVIGATION = 0, ASSISTANT_EXTERNAL_REDIRECT = 0)
  allowedGuidanceRoutes: [
    "/",
    "/settings",
    "/staff/manage",
    "/staff/board",
    "/staff/qr-scanner",
    "/tutors",
    "/pets",
    "/bookings",
    "/bookings/new",
    "/financial",
    "/tutor/financial",
    "/tutor/store",
    "/chat",
    "/assinatura",
    "/marketing/campaigns",
    "/admin/creches",
    "/admin/campaigns",
    "/admin/proposals",
    "/admin/users",
  ] as const,

  // Guidance Target Allowlist (ARBITRARY_CSS_SELECTOR_FROM_MODEL = 0, ASSISTANT_ARBITRARY_DOM_TARGETING = 0)
  allowedGuidanceTargets: [
    "creche-profile-form",
    "staff-create-button",
    "tutor-create-button",
    "pet-create-button",
    "booking-create-button",
    "pet-search-input",
    "booking-filter-status",
    "staff-board-checkin-tab",
    "staff-board-feeding-tab",
    "staff-board-meds-tab",
    "staff-board-walks-tab",
    "chat-input-textarea",
  ] as const,
};
