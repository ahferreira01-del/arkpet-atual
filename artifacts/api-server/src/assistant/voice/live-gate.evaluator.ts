/**
 * ArkPet R41.D — Live STT Gate Evaluator
 * Deterministic evaluation logic for live speech-to-text, assistant binding, and function calling gates.
 */

export interface LiveGateInput {
  httpStatus: number;
  detectedLanguage: string;
  transcript: string;
  audioContainsRealSpeech: boolean;
  c1Message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }> | null;
  } | null;
  c2Content?: string | null;
}

export interface LiveGateResult {
  authenticatedRequestPass: boolean;
  httpStatus: number;
  nonEmptyTranscriptPass: boolean;
  ptBrPass: boolean;
  semanticMatchPass: boolean;
  liveVoiceToAssistant: boolean;
  liveVoiceToolCallPass: boolean;
  liveVoiceToolName: string;
  liveVoiceModelToolModelPass: boolean;
  overallCertificationPass: boolean;
}

export function evaluateLiveGates(input: LiveGateInput): LiveGateResult {
  const authenticatedRequestPass = input.httpStatus === 200;
  const transcript = (input.transcript || "").trim();
  const nonEmptyTranscriptPass = transcript.length > 0;

  // Strict PT-BR check: must be supported Portuguese language tag, NOT merely non-empty transcript
  const normalizedLang = (input.detectedLanguage || "").trim().toLowerCase();
  const ptBrPass =
    input.audioContainsRealSpeech &&
    (normalizedLang === "pt" ||
      normalizedLang === "pt-br" ||
      normalizedLang.startsWith("pt-") ||
      normalizedLang.includes("portuguese") ||
      normalizedLang.includes("português"));

  // Semantic match: checks that transcript recognizes "pet", "pets", or "arkpet" and question keywords
  const lowerTranscript = transcript.toLowerCase();
  const semanticMatchPass =
    nonEmptyTranscriptPass &&
    (lowerTranscript.includes("pet") || lowerTranscript.includes("arkpet")) &&
    (lowerTranscript.includes("quais") ||
      lowerTranscript.includes("meus") ||
      lowerTranscript.includes("tenho") ||
      lowerTranscript.includes("cadastrad") ||
      lowerTranscript.includes("nome"));

  const c1Msg = input.c1Message;
  const liveVoiceToAssistant = Boolean(
    authenticatedRequestPass &&
      c1Msg &&
      (Boolean(c1Msg.content) || Boolean(c1Msg.tool_calls && c1Msg.tool_calls.length > 0))
  );

  let liveVoiceToolCallPass = false;
  let liveVoiceToolName = "NONE";
  let liveVoiceModelToolModelPass = false;

  if (c1Msg?.tool_calls && c1Msg.tool_calls.length > 0) {
    const primaryTool = c1Msg.tool_calls[0];
    liveVoiceToolName = primaryTool.function?.name || "UNKNOWN";
    if (primaryTool.function?.name === "list_my_pets") {
      liveVoiceToolCallPass = true;
      const c2 = (input.c2Content || "").toLowerCase();
      if (c2.includes("rex") || c2.includes("thor")) {
        liveVoiceModelToolModelPass = true;
      }
    }
  }

  const overallCertificationPass =
    authenticatedRequestPass &&
    input.httpStatus === 200 &&
    nonEmptyTranscriptPass &&
    ptBrPass &&
    semanticMatchPass &&
    input.audioContainsRealSpeech &&
    liveVoiceToAssistant &&
    liveVoiceToolCallPass &&
    liveVoiceModelToolModelPass;

  return {
    authenticatedRequestPass,
    httpStatus: input.httpStatus,
    nonEmptyTranscriptPass,
    ptBrPass,
    semanticMatchPass,
    liveVoiceToAssistant,
    liveVoiceToolCallPass,
    liveVoiceToolName,
    liveVoiceModelToolModelPass,
    overallCertificationPass,
  };
}
