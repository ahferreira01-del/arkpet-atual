export const ASSISTANT_CONFIG = {
  // Feature Flags
  get isAssistantEnabled(): boolean {
    if (process.env.AI_ASSISTANT_ENABLED === "false") return false;
    return true;
  },
  get isVoiceEnabled(): boolean {
    if (this.isKillSwitchActive) return false;
    return process.env.AI_VOICE_ENABLED === "true";
  },
  get areSafeActionsEnabled(): boolean {
    if (this.isKillSwitchActive) return false;
    return process.env.AI_SAFE_ACTIONS_ENABLED === "true";
  },
  get isActionsEnabled(): boolean {
    return this.areSafeActionsEnabled;
  },
  get isKillSwitchActive(): boolean {
    return process.env.AI_ASSISTANT_KILL_SWITCH === "true";
  },

  // Versioning
  promptVersion: "r41-e-1",
  knowledgeVersion: "arkpet-v32-r41c",

  // Safe Actions Configuration (R41.E)
  safeActionConfirmationTtlSeconds: 300, // 5 minutes
  safeActionMaxPendingPerUser: 20,
  safeActionPreviewRateLimit: 30, // 30 req/min/user
  safeActionExecuteRateLimit: 15, // 15 req/min/user

  // Voice & Speech-to-Text Configuration (R41.D)
  get voiceSttProvider(): string {
    return (process.env.VOICE_STT_PROVIDER || "groq").toLowerCase();
  },
  get voiceSttModel(): string {
    return process.env.VOICE_STT_MODEL || "whisper-large-v3-turbo";
  },
  get voiceSttLanguage(): string {
    return process.env.VOICE_STT_LANGUAGE || "pt";
  },
  voiceMaxDurationSeconds: 60,
  voiceMaxUploadBytes: 10 * 1024 * 1024, // 10 MB
  allowedAudioMimeTypes: [
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/mpeg",
    "audio/mp4",
  ] as const,

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
