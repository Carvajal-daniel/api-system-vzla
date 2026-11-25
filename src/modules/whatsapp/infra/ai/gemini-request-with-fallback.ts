export interface GeminiFallbackFetchInput {
  apiKey: string;
  primaryModel: string;
  fallbackModel?: string | undefined;
  body: Record<string, unknown>;
  timeoutMs?: number | undefined;
}

export interface GeminiFallbackFetchResult {
  response: Response;
  usedModel: string;
}

const RETRYABLE_GEMINI_STATUSES = new Set([404, 429, 503]);

// Executa generateContent no modelo principal do Gemini e, em caso de 404 (modelo indisponível/descontinuado),
// 503 (alta demanda) ou 429 (rate limit), faz uma segunda tentativa automática no modelo de fallback antes de falhar.
export async function fetchGeminiGenerateContentWithFallback(
  input: GeminiFallbackFetchInput,
): Promise<GeminiFallbackFetchResult> {
  const timeoutMs = input.timeoutMs ?? 15_000;
  const serializedBody = JSON.stringify(input.body);

  const attempt = async (model: string): Promise<Response> => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: serializedBody,
    });
  };

  const primaryResponse = await attempt(input.primaryModel);

  const fallbackModel = input.fallbackModel?.trim();
  if (
    RETRYABLE_GEMINI_STATUSES.has(primaryResponse.status) &&
    fallbackModel &&
    fallbackModel !== input.primaryModel
  ) {
    console.warn(
      `[WhatsApp AI] Gemini ${input.primaryModel} retornou HTTP ${primaryResponse.status}; tentando fallback automático em ${fallbackModel}.`,
    );
    const fallbackResponse = await attempt(fallbackModel);
    return { response: fallbackResponse, usedModel: fallbackModel };
  }

  return { response: primaryResponse, usedModel: input.primaryModel };
}
