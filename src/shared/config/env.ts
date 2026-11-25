import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().min(1).optional(),
);

// Schema de validação opcional das chaves e modelos de IA (OpenAI e Gemini).
export const aiEnvSchema = z.object({
  GEMINI_API_KEY: optionalNonEmptyString,
  GEMINI_MODEL: optionalNonEmptyString,
  GEMINI_FALLBACK_MODEL: optionalNonEmptyString,
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_MODEL: optionalNonEmptyString,
});

export interface AiEnvConfig {
  geminiApiKey?: string | undefined;
  geminiModel: string;
  geminiFallbackModel: string;
  openAiApiKey?: string | undefined;
  openAiModel: string;
}

export function getAiEnv(): AiEnvConfig {
  const parsed = aiEnvSchema.parse(process.env);
  return {
    geminiApiKey: parsed.GEMINI_API_KEY,
    geminiModel: parsed.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    geminiFallbackModel: parsed.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash",
    openAiApiKey: parsed.OPENAI_API_KEY,
    openAiModel: parsed.OPENAI_MODEL ?? "gpt-4o-mini",
  };
}

export function getGeminiApiKey(): string | undefined {
  return getAiEnv().geminiApiKey;
}

export function getOpenAiApiKey(): string | undefined {
  return getAiEnv().openAiApiKey;
}

export function getGoogleMapsApiKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() || undefined;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required.");
  }

  return secret;
}

export function getJwtExpiresIn(): string {
  // Permite configurar a validade do token por ambiente, mantendo 1 dia como padrão seguro.
  const expiresIn = process.env.JWT_EXPIRES_IN?.trim();
  return expiresIn || "1d";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getCorsOrigins(): string[] | false {
  // Permite múltiplas origens separadas por vírgula em CORS_ORIGIN; fora de produção usa localhost do Vite como padrão seguro.
  const raw = process.env.CORS_ORIGIN?.trim();

  if (raw) {
    const origins = raw
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);

    if (origins.length > 0) {
      return origins;
    }
  }

  return isProduction() ? false : ["http://localhost:5173"];
}
