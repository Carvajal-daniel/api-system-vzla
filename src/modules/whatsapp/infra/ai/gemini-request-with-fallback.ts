import { setTimeout as delay } from "node:timers/promises";

export interface GeminiFallbackFetchInput {
  apiKey: string;
  primaryModel: string;
  fallbackModel?: string | undefined;
  body: Record<string, unknown> | ((model: string) => Record<string, unknown>);
  timeoutMs?: number | undefined;
}

export interface GeminiFallbackFetchResult {
  response: Response;
  usedModel: string;
}

const RETRYABLE_GEMINI_STATUSES = new Set([429, 503]);
const GEMINI_MAX_RETRIES = 2;

export async function fetchGeminiGenerateContentWithFallback(
  input: GeminiFallbackFetchInput,
): Promise<GeminiFallbackFetchResult> {
  const timeoutMs = input.timeoutMs ?? 15_000;

  const attempt = async (model: string): Promise<Response> => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(typeof input.body === "function" ? input.body(model) : input.body),
    });
  };

  const fallbackModel = input.fallbackModel?.trim();
  let model = input.primaryModel;
  let retries = 0;

  while (true) {
    let response: Response;
    try {
      response = await attempt(model);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TimeoutError" || retries >= GEMINI_MAX_RETRIES) {
        throw error;
      }
      retries++;
      await delay(500 + Math.random() * 500);
      continue;
    }

    const transient = RETRYABLE_GEMINI_STATUSES.has(response.status);
    const changeModel = fallbackModel && fallbackModel !== model &&
      (transient || response.status === 404);
    if (retries >= GEMINI_MAX_RETRIES || (!transient && !changeModel)) {
      return { response, usedModel: model };
    }

    await response.body?.cancel().catch(() => undefined);
    if (changeModel) model = fallbackModel;
    retries++;
    if (transient) await delay(500 + Math.random() * 500);
  }
}
