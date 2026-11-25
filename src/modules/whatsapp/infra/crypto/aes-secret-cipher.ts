import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SecretCipherPort } from "../../application/ports/secret-cipher.port.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function resolveSecretKey(): Buffer {
  const rawKey =
    process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.JWT_SECRET?.trim();

  if (!rawKey) {
    throw new Error(
      "WHATSAPP_TOKEN_ENCRYPTION_KEY or JWT_SECRET is required to encrypt provider tokens.",
    );
  }

  return createHash("sha256").update(rawKey).digest();
}

// Implementação AES-256-GCM nativa do Node.js para proteger tokens da Datafy no banco de dados.
export class AesSecretCipher implements SecretCipherPort {
  encrypt(plainText: string): string {
    const key = resolveSecretKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
  }

  decrypt(cipherText: string): string {
    const parts = cipherText.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted token format.");
    }
    const [ivB64, tagB64, dataB64] = parts;
    const key = resolveSecretKey();
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivB64!, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64!, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
}
