// Resend email service via Replit connector
import { Resend } from "resend";

const APP_URL = process.env.APP_URL || "https://pet-daycare-master.replit.app";

const ROLE_LABELS: Record<string, string> = {
  creche_admin: "Administrador de Creche",
  staff: "Funcionário",
  tutor: "Tutor",
};

// Get Resend client — checks env vars first, then Replit connector as fallback
async function getUncachableResendClient(): Promise<{ client: Resend; fromEmail: string } | null> {
  // Primary: use env vars (RESEND_API_KEY + RESEND_FROM_EMAIL)
  if (process.env.RESEND_API_KEY) {
    return {
      client: new Resend(process.env.RESEND_API_KEY),
      fromEmail: process.env.RESEND_FROM_EMAIL || "ArkPet <noreply@arkpet.com.br>",
    };
  }

  // Fallback: Replit connector
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

    if (!hostname || !xReplitToken) return null;

    const resp = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`,
      {
        headers: {
          Accept: "application/json",
          "X-Replit-Token": xReplitToken,
        },
      }
    );
    const data = await resp.json();
    const settings = data.items?.[0]?.settings;

    if (!settings?.api_key) return null;

    return {
      client: new Resend(settings.api_key),
      fromEmail: settings.from_email || "ArkPet <noreply@arkpet.com.br>",
    };
  } catch {
    return null;
  }
}

interface WelcomeEmailParams {
  name: string;
  email: string;
  role: string;
  tempPassword: string;
  crecheName?: string;
}

function buildWelcomeHtml(params: WelcomeEmailParams): string {
  const { name, role, tempPassword, crecheName } = params;
  const roleLabel = ROLE_LABELS[role] || role;
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f1a; color: #e2e8f0; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 40px; }
    .logo { text-align: center; margin-bottom: 32px; }
    .logo-icon { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; background: linear-gradient(135deg, #8b5cf6, #a78bfa); border-radius: 14px; font-size: 28px; margin-bottom: 12px; }
    .logo-text { font-size: 24px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
    h1 { font-size: 22px; font-weight: 700; color: #fff; margin: 0 0 8px; }
    p { color: #94a3b8; line-height: 1.6; margin: 0 0 16px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: rgba(139,92,246,0.2); border: 1px solid rgba(139,92,246,0.3); color: #a78bfa; font-size: 13px; font-weight: 600; margin-bottom: 24px; }
    .cred-box { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 20px; margin: 24px 0; }
    .cred-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .cred-row:last-child { border-bottom: none; }
    .cred-label { color: #64748b; font-size: 13px; }
    .cred-value { color: #e2e8f0; font-size: 13px; font-weight: 600; font-family: monospace; }
    .btn { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #8b5cf6, #a78bfa); color: #fff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; margin: 24px 0; }
    .warning { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); border-radius: 10px; padding: 14px 18px; color: #fbbf24; font-size: 13px; margin-top: 20px; }
    .footer { text-align: center; margin-top: 32px; color: #475569; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">
        <div class="logo-icon">🐾</div>
        <div class="logo-text">ArkPet</div>
      </div>

      <h1>Bem-vindo(a) ao ArkPet, ${name}!</h1>
      <p>Sua conta foi criada com sucesso${crecheName ? ` na creche <strong style="color:#e2e8f0">${crecheName}</strong>` : ""}.</p>
      <span class="badge">${roleLabel}</span>

      <p style="margin-top:20px">Suas credenciais de acesso:</p>
      <div class="cred-box">
        <div class="cred-row">
          <span class="cred-label">E-mail</span>
          <span class="cred-value">${params.email}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">Senha temporária</span>
          <span class="cred-value">${tempPassword}</span>
        </div>
      </div>

      <div style="text-align:center">
        <a href="${APP_URL}" class="btn">Acessar o ArkPet →</a>
      </div>

      <div class="warning">
        ⚠️ Por segurança, você será solicitado(a) a alterar sua senha no primeiro acesso. Não compartilhe suas credenciais com ninguém.
      </div>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} ArkPet. Todos os direitos reservados.</p>
      <p>Se você não esperava este e-mail, pode ignorá-lo com segurança.</p>
    </div>
  </div>
</body>
</html>`.trim();
}

export async function sendWelcomeEmail(params: WelcomeEmailParams): Promise<void> {
  const roleLabel = ROLE_LABELS[params.role] || params.role;
  const resend = await getUncachableResendClient();

  if (!resend) {
    console.log(`[email] Resend not configured — would send welcome email to ${params.email} (${roleLabel})`);
    return;
  }

  const { error } = await resend.client.emails.send({
    from: resend.fromEmail,
    to: params.email,
    subject: "Bem-vindo(a) ao ArkPet! Sua conta foi criada",
    html: buildWelcomeHtml(params),
  });

  if (error) {
    console.error(`[email] Failed to send welcome email to ${params.email}:`, error);
    throw new Error(error.message);
  }

  console.log(`[email] Welcome email sent to ${params.email} (${roleLabel})`);
}

export async function sendPasswordResetEmail(params: {
  name: string;
  email: string;
  resetLink: string;
}): Promise<void> {
  const resend = await getUncachableResendClient();

  if (!resend) {
    console.log(`[email] Resend not configured — would send password reset to ${params.email}`);
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8" /><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f1a; color: #e2e8f0; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
.card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 40px; }
h1 { font-size: 22px; font-weight: 700; color: #fff; margin: 0 0 16px; }
p { color: #94a3b8; line-height: 1.6; margin: 0 0 16px; }
.btn { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #8b5cf6, #a78bfa); color: #fff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; margin: 24px 0; }
</style></head>
<body><div class="container"><div class="card">
  <h1>🐾 Redefinição de senha</h1>
  <p>Olá, <strong style="color:#e2e8f0">${params.name}</strong>. Recebemos uma solicitação para redefinir sua senha no ArkPet.</p>
  <div style="text-align:center"><a href="${params.resetLink}" class="btn">Redefinir minha senha →</a></div>
  <p style="font-size:13px;color:#64748b">Este link expira em 1 hora. Se você não solicitou a redefinição, ignore este e-mail com segurança.</p>
</div></div></body></html>`.trim();

  await resend.client.emails.send({
    from: resend.fromEmail,
    to: params.email,
    subject: "Redefinição de senha — ArkPet",
    html,
  });
}
