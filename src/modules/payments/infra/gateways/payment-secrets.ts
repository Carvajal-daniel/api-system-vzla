
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("PAYMENT_ENCRYPTION_KEY must contain at least 32 characters");
  return createHash("sha256").update(secret).digest();
}

export function encryptPaymentSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptPaymentSecret(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Invalid payment secret");
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(encrypted!), decipher.final()]).toString("utf8");
}
