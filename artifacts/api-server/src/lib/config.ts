// Resolves the public base URL of the web app, used to build links in e-mails
// (password reset, welcome, etc). Priority:
//   1. APP_URL env (set this in production to the deployed domain)
//   2. REPLIT_DEV_DOMAIN (automatic in the Replit dev environment)
//   3. a last-resort fallback
export function getAppBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "https://pet-daycare-master.replit.app";
}
