// Stripe integration via Replit connector (managed credentials).
// Falls back to STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY env vars when the
// connector is unavailable (e.g. production configured with direct keys).
// Credentials are fetched fresh on every call — never cache the client.
import Stripe from "stripe";
import type { StripeSync } from "stripe-replit-sync";

async function getCredentials(): Promise<{ publishableKey: string; secretKey: string }> {
  // Try Replit connector first
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (hostname && xReplitToken) {
    try {
      const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
      const targetEnvironment = isProduction ? "production" : "development";

      const url = new URL(`https://${hostname}/api/v2/connection`);
      url.searchParams.set("include_secrets", "true");
      url.searchParams.set("connector_names", "stripe");
      url.searchParams.set("environment", targetEnvironment);

      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
        signal: AbortSignal.timeout(3_000),
      });

      const data: any = await response.json();
      const settings = data.items?.[0]?.settings;

      if (settings?.secret && settings?.publishable) {
        return { publishableKey: settings.publishable, secretKey: settings.secret };
      }

      console.warn(
        `[stripe] Conector Replit (${targetEnvironment}) sem chaves — tentando variáveis de ambiente...`,
      );
    } catch (err) {
      console.warn(
        "[stripe] Falha ao buscar credenciais pelo conector:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Fallback: direct env vars (useful for production test-mode override)
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

  if (secretKey && publishableKey) {
    return { publishableKey, secretKey };
  }

  throw new Error(
    "Stripe não configurado: conecte o Stripe na aba Integrations ou defina " +
      "STRIPE_SECRET_KEY e STRIPE_PUBLISHABLE_KEY nas variáveis de ambiente.",
  );
}

// Canonical Stripe API version pinned for outgoing SDK requests under stripe-node v22.
export const STRIPE_API_VERSION = "2026-03-25.dahlia" as const;

// Server-side operations (secret key). Never cache the returned client.
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION as any,
  });
}

// Client-side publishable key (safe to expose to the browser).
export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey(): Promise<string> {
  const { secretKey } = await getCredentials();
  return secretKey;
}

// StripeSync singleton for webhook processing and data sync into the `stripe` schema.
let stripeSync: StripeSync | null = null;

export async function getStripeSync(): Promise<StripeSync> {
  if (!stripeSync) {
    const { StripeSync } = await import("stripe-replit-sync");
    const secretKey = await getStripeSecretKey();
    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
