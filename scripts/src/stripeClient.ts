// Stripe client for one-off scripts (e.g. seeding products/prices).
// Tries the Replit connector first; falls back to STRIPE_SECRET_KEY env var
// so the script works both in Replit connector mode and with direct env keys.
import Stripe from "stripe";

async function getCredentials(): Promise<{ secretKey: string }> {
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
        signal: AbortSignal.timeout(5_000),
      });

      const data: any = await response.json();
      const settings = data.items?.[0]?.settings;

      if (settings?.secret) {
        return { secretKey: settings.secret };
      }
      console.warn(`[seed-stripe] Conector Replit sem chaves — tentando STRIPE_SECRET_KEY...`);
    } catch {
      console.warn("[seed-stripe] Falha no conector Replit — tentando STRIPE_SECRET_KEY...");
    }
  }

  // Fallback: direct env var (api-server .env or shell export)
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (secretKey) {
    return { secretKey };
  }

  throw new Error(
    "Stripe não configurado: conecte o Stripe na aba Integrations ou defina STRIPE_SECRET_KEY.",
  );
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey);
}
