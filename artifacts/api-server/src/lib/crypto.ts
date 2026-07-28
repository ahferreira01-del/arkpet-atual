import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

// Returns a stable 32-byte AES key.
// Priority: ENCRYPTION_KEY env var → SESSION_SECRET env var (always available in prod).
// Any input is SHA-256-hashed to guarantee exactly 32 bytes regardless of length.
function getEncryptionKey(): Buffer {
  const keyStr = process.env.ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!keyStr) {
    throw new Error(
      "No encryption key available: set ENCRYPTION_KEY or SESSION_SECRET.",
    );
  }
  // SHA-256 of the key material → always 32 bytes, safe for AES-256-GCM.
  return crypto.createHash("sha256").update(keyStr).digest();
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag().toString("hex");
  
  // Format: iv:authTag:encryptedText
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encText: string): string {
  const parts = encText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }
  
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encryptedText = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}
