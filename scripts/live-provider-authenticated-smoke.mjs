/**
 * ArkPet R41.A-FINAL.4 — Authenticated Live Provider Smoke Script
 * Executes exactly one authenticated live request using configured OPENAI_API_KEY.
 * Strictly enforces normal TLS certificate validation (no insecure bypass).
 * Strictly fails closed if no valid key is configured.
 * Strictly avoids logging secrets or sensitive customer data.
 */

import dotenv from "dotenv";
dotenv.config({ quiet: true });
dotenv.config({ path: "artifacts/api-server/.env", quiet: true });

async function runAuthenticatedSmoke() {
  const provider = "OpenAI";
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  const endpoint = "https://api.openai.com/v1/chat/completions";
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();

  // Fail closed if key is missing or is a placeholder
  if (!apiKey || apiKey === "sk-dev-connectivity-check" || apiKey.startsWith("sk-placeholder") || apiKey === "mock") {
    console.error("[AUTHENTICATED_SMOKE_FAIL] Server-side OPENAI_API_KEY is not configured or is a placeholder.");
    console.log("AUTHENTICATED_SMOKE_FAIL_CLOSED = PASS");
    console.log("TLS_CERTIFICATE_VALIDATION = ENABLED");
    console.log("REAL_PROVIDER_AUTHENTICATED_REQUEST = NOT_PROVEN");
    console.log("REAL_PROVIDER_LIVE_RESPONSE = NOT_PROVEN");
    console.log("R41_A_CERTIFICATION_STATUS = BLOCKED_BY_LIVE_CREDENTIAL");
    process.exit(1);
  }

  const prompt = "Como faço uma reserva no ArkPet?";
  const startTime = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "Você é o ArkPet Assistente, assistente virtual inteligente da plataforma ArkPet (gestão de creches e hospedagens caninas, Day Use, Hotel, Pets, Tutores e Reservas). Responda de forma profissional e concisa em português brasileiro.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 250,
        temperature: 0.2,
      }),
    });

    const latency = Date.now() - startTime;
    const status = res.status;

    if (status === 401 || status === 403) {
      console.error(`[AUTH_FAILURE] Provider rejected credentials with HTTP ${status}.`);
      console.log("REAL_PROVIDER_AUTHENTICATION = FAIL");
      console.log("REAL_PROVIDER_AUTHENTICATED_REQUEST = NOT_PROVEN");
      console.log("REAL_PROVIDER_LIVE_RESPONSE = NOT_PROVEN");
      process.exit(1);
    }

    if (status === 429) {
      console.error(`[RATE_LIMITED] Provider rate limit exceeded (HTTP 429).`);
      console.log("REAL_PROVIDER_RATE_LIMITED = YES");
      console.log("REAL_PROVIDER_AUTHENTICATED_REQUEST = NOT_PROVEN");
      console.log("REAL_PROVIDER_LIVE_RESPONSE = NOT_PROVEN");
      process.exit(1);
    }

    if (!res.ok) {
      console.error(`[PROVIDER_FAILURE] Provider responded with HTTP ${status}.`);
      console.log("REAL_PROVIDER_AVAILABILITY = FAIL");
      console.log("REAL_PROVIDER_AUTHENTICATED_REQUEST = NOT_PROVEN");
      console.log("REAL_PROVIDER_LIVE_RESPONSE = NOT_PROVEN");
      process.exit(1);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const totalTokens = data.usage?.total_tokens || "N/A";

    // Validate response quality and boundaries
    const lowerContent = content.toLowerCase();
    const mentionsReservation =
      lowerContent.includes("reserva") ||
      lowerContent.includes("agendamento") ||
      lowerContent.includes("day use") ||
      lowerContent.includes("hotel") ||
      lowerContent.includes("hospedagem");

    const unsupportedKeywords = ["drone", "telepatia", "blockchain", "bitcoin", "laser"];
    const hasUnsupported = unsupportedKeywords.some((kw) => lowerContent.includes(kw));

    const leakedSecrets =
      content.includes("sk-") ||
      lowerContent.includes("jwt_secret") ||
      lowerContent.includes("database_url");

    if (!mentionsReservation) {
      console.error("[VALIDATION_FAIL] Response did not mention ArkPet reservation capabilities.");
      process.exit(1);
    }

    if (hasUnsupported) {
      console.error("[VALIDATION_FAIL] Response hallucinated unsupported features.");
      process.exit(1);
    }

    if (leakedSecrets) {
      console.error("[SECURITY_FAIL] Potential secret detected in response content.");
      process.exit(1);
    }

    // Safe evidence record
    console.log(JSON.stringify({
      event: "real_provider_authenticated_smoke",
      provider,
      model,
      httpStatus: status,
      latencyMs: latency,
      responseLength: content.length,
      tokensUsed: totalTokens,
      tlsValidation: "ENABLED",
      secretLeakage: "CLEAN",
      timestamp: new Date().toISOString(),
    }, null, 2));

    console.log("\n--- MODEL RESPONSE SUMMARY (SAFE) ---");
    console.log(content.trim().slice(0, 300) + (content.length > 300 ? "..." : ""));
    console.log("------------------------------------\n");

    console.log("TLS_CERTIFICATE_VALIDATION = ENABLED");
    console.log("OPENAI_ENDPOINT_NETWORK_REACHABILITY = PASS");
    console.log("REAL_PROVIDER_AUTHENTICATED_REQUEST = PASS");
    console.log("REAL_PROVIDER_HTTP_STATUS = 200");
    console.log("REAL_PROVIDER_LIVE_RESPONSE = PASS");
    console.log(`REAL_PROVIDER_RESPONSE_LENGTH = ${content.length}`);
    console.log(`REAL_PROVIDER_LATENCY_MS = ${latency}`);
    console.log(`REAL_PROVIDER_TOKEN_USAGE = ${totalTokens}`);
    console.log("REAL_PROVIDER_RESPONSE_SECRET_LEAK = 0");
    console.log("R41_A_CERTIFICATION_STATUS = FULLY_CERTIFIED");
  } catch (err) {
    console.error("Authenticated live smoke error:", err.message);
    console.log("REAL_PROVIDER_AVAILABILITY = FAIL");
    console.log("REAL_PROVIDER_AUTHENTICATED_REQUEST = NOT_PROVEN");
    console.log("REAL_PROVIDER_LIVE_RESPONSE = NOT_PROVEN");
    process.exit(1);
  }
}

runAuthenticatedSmoke();
