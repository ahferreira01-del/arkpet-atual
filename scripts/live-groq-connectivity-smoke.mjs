/**
 * ArkPet R41.A-FINAL.5 — Live Groq Connectivity Smoke Script
 * Tests DNS, TLS, and network reachability to Groq's OpenAI-compatible endpoint.
 * Strictly uses normal TLS certificate validation. Zero insecure bypasses.
 * HTTP 401 certifies endpoint reachability without certifying authenticated inference.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import dotenv from "dotenv";

const defaultCaCert = path.join(os.homedir(), ".kaspersky-ca.pem");
if (!process.env.NODE_EXTRA_CA_CERTS && fs.existsSync(defaultCaCert) && !process.env.__CHILD_SPAWNED) {
  const result = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: defaultCaCert, __CHILD_SPAWNED: "1" },
    stdio: "inherit",
  });
  process.exit(result.status ?? 0);
}

dotenv.config({ quiet: true });
dotenv.config({ path: "artifacts/api-server/.env", quiet: true });

async function runGroqConnectivitySmoke() {
  const provider = "groq";
  const model = process.env.AI_MODEL || "openai/gpt-oss-20b";
  const endpoint = `${process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"}/chat/completions`;
  const apiKey = (process.env.GROQ_API_KEY || "").trim() || "gsk_dev_connectivity_check";

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
          { role: "system", content: "Você é o ArkPet Assistente. Responda em português." },
          { role: "user", content: prompt },
        ],
        max_tokens: 150,
      }),
    });

    const latency = Date.now() - startTime;
    const status = res.status;

    console.log(JSON.stringify({
      event: "groq_live_connectivity_smoke",
      provider,
      model,
      endpoint,
      httpStatus: status,
      latencyMs: latency,
      connectivity: "LIVE_CONFIRMED",
      tlsValidation: "ENABLED",
      secretsExposed: false,
    }, null, 2));

    if (status === 200) {
      console.log(`[GROQ_CONNECTIVITY_PASS] Endpoint reachable and authenticated. HTTP 200 in ${latency}ms.`);
      console.log("GROQ_ENDPOINT_REACHABILITY = PASS");
      console.log("TLS_CERTIFICATE_VALIDATION = ENABLED");
      console.log("GROQ_AUTHENTICATED_REQUEST = PASS");
    } else if (status === 401) {
      console.log(`[GROQ_CONNECTIVITY_PASS] Endpoint reachable via TLS (HTTP 401 Unauthorized in ${latency}ms).`);
      console.log("GROQ_ENDPOINT_REACHABILITY = PASS");
      console.log("TLS_CERTIFICATE_VALIDATION = ENABLED");
      console.log("GROQ_AUTHENTICATED_REQUEST = NOT_PROVEN");
    } else {
      console.log(`[GROQ_CONNECTIVITY_RESULT] Endpoint responded with HTTP ${status} in ${latency}ms.`);
      console.log("GROQ_ENDPOINT_REACHABILITY = PASS");
      console.log("TLS_CERTIFICATE_VALIDATION = ENABLED");
    }
  } catch (err) {
    console.error("Groq live connectivity error:", err.message);
    console.log("GROQ_ENDPOINT_REACHABILITY = FAIL");
    process.exit(1);
  }
}

runGroqConnectivitySmoke();
