import { getAiEnv } from "../../../../shared/config/env.js";
import { fetchGeminiGenerateContentWithFallback } from "../../../whatsapp/infra/ai/gemini-request-with-fallback.js";
import { buildLocalBusinessCopilotReply } from "../../../whatsapp/infra/ai/business-copilot.adapter.js";
import type {
  AiTextGenerationResult,
  AiUsageTokens,
  CopilotStreamAiInput,
  CopilotStreamEvent,
  IntelligenceAiPort,
  ModuleAnalysisAiResult,
  ModuleAnalysisResult,
  ProactiveInsightCandidate,
  ProactiveInsightsAiResult,
  RetentionMessagePromptInput,
} from "../../application/ports/intelligence-ai.port.js";
import type {
  ModuleMetricsPayload,
  ProactiveScanMetrics,
} from "../../domain/entities/proactive-insight.types.js";

const FAST_MODULE_ANALYSIS_MODEL = "gemini-3.5-flash-lite";

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function extractJsonObject(rawText: string): unknown {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function buildFallbackRetentionMessage(
  input: RetentionMessagePromptInput,
): string {
  const { client, companyName, track } = input;
  const serviceText = client.lastServiceName
    ? ` de ${client.lastServiceName}`
    : "";
  const collabText = client.preferredCollaboratorName
    ? ` com ${client.preferredCollaboratorName}`
    : "";

  if (track === "TRACK_3_UNHAPPY") {
    const ratingInfo =
      client.lastReviewRating !== null
        ? ` (nota ${client.lastReviewRating}/5)`
        : "";
    return `Olá, ${client.clientName}. Aqui é da equipe da ${companyName}. Vimos sua última avaliação${ratingInfo} e pedimos sinceras desculpas por não termos entregue a experiência que você merece. Gostaria de conversar rapidamente para entendermos como podemos melhorar e reparar isso para você?`;
  }

  if (track === "TRACK_2_CANCELED") {
    return `Oi, ${client.clientName}! Tudo bem? Aqui é da ${companyName}. Vi que você precisou cancelar seu último horário${serviceText} — sem pressão nenhuma, mas quando quiser remarcar${collabText}, é só me chamar por aqui que já separo um horário legal pra você!`;
  }

  return `Oi, ${client.clientName}! Tudo bem? Faz um tempinho desde seu último atendimento${serviceText}${collabText} aqui na ${companyName}. Quando quiser renovar o visual, me avisa por aqui que já olho os melhores horários disponíveis pra você!`;
}

export function buildDeterministicProactiveInsights(
  metrics: ProactiveScanMetrics,
): ProactiveInsightCandidate[] {
  const candidates: ProactiveInsightCandidate[] = [];

  // 1. AGENDA: buracos >50% nas próximas 48h
  const criticalGap = metrics.agendaGaps.find((gap) => gap.idlePercentage > 50);
  if (criticalGap) {
    candidates.push({
      module: "AGENDA",
      type: `AGENDA_GAP_48H_${criticalGap.collaboratorId.slice(0, 8)}`,
      title: `Agenda com ${criticalGap.idlePercentage}% livre nas próximas 48h (${criticalGap.collaboratorName})`,
      description: `${criticalGap.collaboratorName} tem apenas ${criticalGap.bookedMinutes48h} min agendados de ${criticalGap.totalAvailableMinutes48h} min disponíveis nas próximas 48h. Dispare um convite rápido para clientes habituais preencherem os horários.`,
      impactLabel: `${criticalGap.idlePercentage}% ocioso em 48h`,
      actionPayload: {
        actionType: "WHATSAPP_BROADCAST",
        collaboratorId: criticalGap.collaboratorId,
        collaboratorName: criticalGap.collaboratorName,
        recipients: criticalGap.habitualClients,
        messageTemplate: `Oi {{name}}! Abriram horários especiais com ${criticalGap.collaboratorName} na ${metrics.companyName} nas próximas 48h. Quer garantir o seu?`,
      },
    });
  }

  // 2. FINANCE: comparação semana atual vs anterior
  if (
    metrics.finance.previousWeekRevenueCents > 0 &&
    metrics.finance.revenueDeltaPercent <= -15
  ) {
    candidates.push({
      module: "FINANCE",
      type: "FINANCE_WEEKLY_DROP",
      title: `Queda de ${Math.abs(metrics.finance.revenueDeltaPercent)}% no faturamento semanal`,
      description: `O faturamento caiu de ${formatBrl(metrics.finance.previousWeekRevenueCents)} para ${formatBrl(metrics.finance.currentWeekRevenueCents)} (ticket médio atual: ${formatBrl(metrics.finance.currentWeekAvgTicketCents)}). Vale ativar campanhas de retorno ou combos para recuperar o ritmo.`,
      impactLabel: `${metrics.finance.revenueDeltaPercent}% vs semana anterior`,
      actionPayload: {
        actionType: "REVIEW_FINANCE",
        currentWeekRevenueCents: metrics.finance.currentWeekRevenueCents,
        previousWeekRevenueCents: metrics.finance.previousWeekRevenueCents,
      },
    });
  } else if (
    metrics.finance.currentWeekRevenueCents > 0 &&
    metrics.finance.peakDayOfWeek
  ) {
    candidates.push({
      module: "FINANCE",
      type: "FINANCE_WEEKLY_PEAK",
      title: `${metrics.finance.peakDayOfWeek} lidera o faturamento da semana`,
      description: `A semana soma ${formatBrl(metrics.finance.currentWeekRevenueCents)} com ticket médio de ${formatBrl(metrics.finance.currentWeekAvgTicketCents)}. Reforce a oferta de adicionais nos dias mais fracos para equilibrar o caixa.`,
      impactLabel: formatBrl(metrics.finance.currentWeekRevenueCents),
      actionPayload: {
        actionType: "REVIEW_FINANCE",
        peakDayOfWeek: metrics.finance.peakDayOfWeek,
      },
    });
  }

  // 3. SERVICES: combos frequentes
  const topCombo = metrics.serviceCombos[0];
  if (topCombo) {
    candidates.push({
      module: "SERVICES",
      type: "SERVICES_COMBO_OPPORTUNITY",
      title: `Crie o combo "${topCombo.serviceA} + ${topCombo.serviceB}"`,
      description: `Esses dois serviços foram agendados juntos ${topCombo.coOccurrenceCount} vezes nos últimos 60 dias. Oferecer um pacote fechado aumenta a conversão e o ticket médio.`,
      impactLabel: `${topCombo.coOccurrenceCount}x juntos em 60d`,
      actionPayload: {
        actionType: "CREATE_COMBO",
        serviceA: topCombo.serviceA,
        serviceB: topCombo.serviceB,
      },
    });
  }

  // 4. INVENTORY: estoque mínimo ou parado há +60 dias
  if (metrics.inventory.lowStockItems.length > 0) {
    const names = metrics.inventory.lowStockItems
      .slice(0, 3)
      .map((i) => `${i.name} (${i.currentStock}/${i.minStock})`)
      .join(", ");
    candidates.push({
      module: "INVENTORY",
      type: "INVENTORY_LOW_STOCK",
      title: `${metrics.inventory.lowStockItems.length} item(ns) no estoque mínimo`,
      description: `Itens críticos para reposição imediata: ${names}. Evite ruptura de estoque e perda de vendas na bancada.`,
      impactLabel: `${metrics.inventory.lowStockItems.length} item(ns) críticos`,
      actionPayload: {
        actionType: "RESTOCK_INVENTORY",
        items: metrics.inventory.lowStockItems.slice(0, 5),
      },
    });
  } else if (metrics.inventory.stagnantItems60d.length > 0) {
    const names = metrics.inventory.stagnantItems60d
      .slice(0, 3)
      .map((i) => i.name)
      .join(", ");
    candidates.push({
      module: "INVENTORY",
      type: "INVENTORY_STAGNANT_60D",
      title: `${metrics.inventory.stagnantItems60d.length} produto(s) parados há +60 dias`,
      description: `Sem vendas registradas nos últimos 60 dias: ${names}. Sugira uma promoção rápida na bancada junto aos serviços principais.`,
      impactLabel: "Capital parado em estoque",
      actionPayload: {
        actionType: "PROMOTE_INVENTORY",
        items: metrics.inventory.stagnantItems60d.slice(0, 5),
      },
    });
  }

  // 5. TEAM: destaque de retorno ou alerta de avaliação/ociosidade
  const lowRatingMember = metrics.team.find(
    (member) => member.averageRating !== null && member.averageRating < 4.0,
  );
  if (lowRatingMember) {
    candidates.push({
      module: "TEAM",
      type: `TEAM_RATING_ALERT_${lowRatingMember.collaboratorId.slice(0, 8)}`,
      title: `Atenção às avaliações de ${lowRatingMember.collaboratorName} (${lowRatingMember.averageRating}/5)`,
      description: `${lowRatingMember.collaboratorName} registrou média ${lowRatingMember.averageRating}/5 em ${lowRatingMember.reviewsCount} avaliações nos últimos 30 dias. Faça um alinhamento individual para elevar a satisfação.`,
      impactLabel: `Nota ${lowRatingMember.averageRating}/5`,
      actionPayload: {
        actionType: "REVIEW_TEAM_MEMBER",
        collaboratorId: lowRatingMember.collaboratorId,
      },
    });
  } else {
    const topReturner = [...metrics.team].sort(
      (a, b) => b.returnRatePercent - a.returnRatePercent,
    )[0];
    if (topReturner && topReturner.completedAppointments30d > 0) {
      candidates.push({
        module: "TEAM",
        type: "TEAM_TOP_RETENTION",
        title: `${topReturner.collaboratorName} lidera a taxa de retorno (${topReturner.returnRatePercent}%)`,
        description: `Foram ${topReturner.completedAppointments30d} atendimentos concluídos nos últimos 30 dias com ${topReturner.returnRatePercent}% de retorno. Replique as boas práticas no time.`,
        impactLabel: `${topReturner.returnRatePercent}% de retorno`,
        actionPayload: {
          actionType: "RECOGNIZE_TEAM_MEMBER",
          collaboratorId: topReturner.collaboratorId,
        },
      });
    }
  }

  return candidates;
}

function buildLocalModuleAnalysis(
  payload: ModuleMetricsPayload,
): ModuleAnalysisResult {
  const { module, companyName, metrics } = payload;

  return {
    module,
    headline: `Diagnóstico rápido de ${module} — ${companyName}`,
    insights: [
      {
        title: `Leitura consolidada do módulo ${module}`,
        detail: `Dados agregados em ${payload.referenceDate} analisados com isolamento multi-tenant (${Object.keys(metrics).join(", ")}).`,
        severity: "INFO",
      },
      {
        title: "Oportunidade de otimização imediata",
        detail:
          "Use os cards proativos e o Copiloto IA para acionar campanhas ou ajustes com 1 clique com base nesses indicadores.",
        severity: "OPPORTUNITY",
      },
    ],
    recommendedAction: `Revisar os indicadores prioritários de ${module} e executar o próximo card pendente em Inteligência.`,
    provider: "LOCAL_ANALYTICS",
  };
}

// Adaptador Gemini para a Etapa 3 com fallback determinístico local quando não houver GEMINI_API_KEY.
export class GeminiIntelligenceAdapter implements IntelligenceAiPort {
  public async generateRetentionMessage(
    input: RetentionMessagePromptInput,
  ): Promise<AiTextGenerationResult> {
    const fallbackText = buildFallbackRetentionMessage(input);
    const aiEnv = getAiEnv();
    if (!aiEnv.geminiApiKey) {
      return {
        text: fallbackText,
        usage: { model: "local-fallback", promptTokens: 0, completionTokens: 0 },
      };
    }

    const trackInstruction =
      input.track === "TRACK_1_SATISFIED"
        ? "Trilha 1 (Cliente satisfeito): escreva uma mensagem curta, calorosa e natural de WhatsApp (máx. 2 frases), citando o último serviço e o profissional preferido quando disponíveis."
        : input.track === "TRACK_2_CANCELED"
          ? "Trilha 2 (Cancelou e não remarcou): escreva uma mensagem leve, empática e sem pressão convidando para remarcar quando for melhor (máx. 2 frases)."
          : "Trilha 3 (Cliente insatisfeito): escreva um rascunho sincero e respeitoso de pedido de desculpas do dono para revisão manual antes do envio (máx. 3 frases).";

    const prompt = [
      `Empresa: ${input.companyName}`,
      trackInstruction,
      "Responda APENAS com o texto da mensagem em português do Brasil, sem aspas nem explicações extras.",
      `Dados do cliente: ${JSON.stringify({
        clientName: input.client.clientName,
        daysSinceLastVisit: input.client.daysSinceLastVisit,
        lastServiceName: input.client.lastServiceName,
        preferredCollaboratorName: input.client.preferredCollaboratorName,
        lastCancellationReason: input.client.lastCancellationReason,
        lastReviewRating: input.client.lastReviewRating,
        lastReviewComment: input.client.lastReviewComment,
      })}`,
    ].join("\n");

    try {
      const { response, usedModel } =
        await fetchGeminiGenerateContentWithFallback({
          apiKey: aiEnv.geminiApiKey,
          primaryModel: aiEnv.geminiModel,
          fallbackModel: aiEnv.geminiFallbackModel,
          timeoutMs: 12_000,
          body: {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.4,
              thinkingConfig: { thinkingLevel: "minimal" },
            },
          },
        });

      if (response.ok) {
        const data = (await response.json()) as GeminiGenerateContentResponse;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          return {
            text,
            usage: {
              model: usedModel,
              promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
              completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
            },
          };
        }
      }
    } catch {
      // Fallback silencioso para texto determinístico seguro
    }

    return {
      text: fallbackText,
      usage: { model: "local-fallback", promptTokens: 0, completionTokens: 0 },
    };
  }

  public async generateProactiveInsights(
    metrics: ProactiveScanMetrics,
  ): Promise<ProactiveInsightsAiResult> {
    const baseInsights = buildDeterministicProactiveInsights(metrics);
    const aiEnv = getAiEnv();

    if (!aiEnv.geminiApiKey || baseInsights.length === 0) {
      return {
        insights: baseInsights,
        usage: { model: "local-analytics", promptTokens: 0, completionTokens: 0 },
      };
    }

    // Usa o Gemini para refinar títulos e descrições executivas mantendo os actionPayloads seguros e determinísticos.
    const prompt = [
      "Você é o motor proativo de gestão de uma barbearia/salão.",
      "Refine os títulos (máx 120 chars) e descrições (máx 260 chars) dos insights abaixo em português do Brasil claro e acionável, mantendo os mesmos índices e números reais.",
      'Retorne APENAS um JSON válido no formato: {"items": [{"index": 0, "title": "...", "description": "...", "impactLabel": "..."}]}',
      JSON.stringify(
        baseInsights.map((item, index) => ({
          index,
          module: item.module,
          type: item.type,
          title: item.title,
          description: item.description,
          impactLabel: item.impactLabel,
        })),
      ),
    ].join("\n");

    try {
      const { response, usedModel } =
        await fetchGeminiGenerateContentWithFallback({
          apiKey: aiEnv.geminiApiKey,
          primaryModel: FAST_MODULE_ANALYSIS_MODEL,
          fallbackModel: aiEnv.geminiFallbackModel,
          timeoutMs: 12_000,
          body: {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.25,
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: "minimal" },
            },
          },
        });

      if (response.ok) {
        const data = (await response.json()) as GeminiGenerateContentResponse;
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (raw) {
          const parsed = extractJsonObject(raw) as {
            items?: Array<{
              index?: number;
              title?: string;
              description?: string;
              impactLabel?: string;
            }>;
          };
          const refined = baseInsights.map((original, idx) => {
            const match = parsed.items?.find((item) => item.index === idx);
            return {
              ...original,
              title: match?.title?.trim() || original.title,
              description: match?.description?.trim() || original.description,
              impactLabel: match?.impactLabel?.trim() || original.impactLabel,
            };
          });
          return {
            insights: refined,
            usage: {
              model: usedModel,
              promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
              completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
            },
          };
        }
      }
    } catch {
      // Fallback determinístico preserva a entrega dos insights
    }

    return {
      insights: baseInsights,
      usage: { model: "local-analytics", promptTokens: 0, completionTokens: 0 },
    };
  }

  public async analyzeModule(
    payload: ModuleMetricsPayload,
  ): Promise<ModuleAnalysisAiResult> {
    const localFallback = buildLocalModuleAnalysis(payload);
    const aiEnv = getAiEnv();
    if (!aiEnv.geminiApiKey) {
      return {
        analysis: localFallback,
        usage: { model: "local-analytics", promptTokens: 0, completionTokens: 0 },
      };
    }

    const prompt = [
      `Analise os KPIs agregados do módulo ${payload.module} da empresa "${payload.companyName}" (${payload.referenceDate}).`,
      "Nunca invente números; use apenas o JSON fornecido.",
      'Retorne APENAS JSON válido no formato: {"headline": "...", "insights": [{"title": "...", "detail": "...", "severity": "INFO|OPPORTUNITY|WARNING"}], "recommendedAction": "..."}',
      JSON.stringify(payload.metrics),
    ].join("\n");

    try {
      const { response, usedModel } =
        await fetchGeminiGenerateContentWithFallback({
          apiKey: aiEnv.geminiApiKey,
          primaryModel: FAST_MODULE_ANALYSIS_MODEL,
          fallbackModel: aiEnv.geminiFallbackModel,
          timeoutMs: 8_000,
          body: {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: "minimal" },
            },
          },
        });

      if (response.ok) {
        const data = (await response.json()) as GeminiGenerateContentResponse;
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (raw) {
          const parsed = extractJsonObject(raw) as {
            headline?: string;
            insights?: Array<{
              title?: string;
              detail?: string;
              severity?: string;
            }>;
            recommendedAction?: string;
          };

          if (parsed.headline && Array.isArray(parsed.insights)) {
            return {
              analysis: {
                module: payload.module,
                headline: parsed.headline.trim(),
                insights: parsed.insights.slice(0, 5).map((item) => ({
                  title: item.title?.trim() || "Destaque do módulo",
                  detail: item.detail?.trim() || "",
                  severity:
                    item.severity === "WARNING" ||
                    item.severity === "OPPORTUNITY"
                      ? item.severity
                      : "INFO",
                })),
                recommendedAction:
                  parsed.recommendedAction?.trim() ||
                  localFallback.recommendedAction,
                provider: "GEMINI",
              },
              usage: {
                model: usedModel,
                promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
                completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
              },
            };
          }
        }
      }
    } catch {
      // Fallback analítico local
    }

    return {
      analysis: localFallback,
      usage: { model: "local-analytics", promptTokens: 0, completionTokens: 0 },
    };
  }

  public async *streamCopilot(
    input: CopilotStreamAiInput,
  ): AsyncGenerator<CopilotStreamEvent> {
    const aiEnv = getAiEnv();
    const systemInstruction = [
      `Você é o Copiloto IA de Gestão da empresa "${input.globalMetrics.companyName}".`,
      "Responda em português do Brasil de forma objetiva, prática e baseada EXCLUSIVAMENTE nos dados reais do tenant abaixo.",
      input.currentModule
        ? `O dono está visualizando agora o módulo: ${input.currentModule}. Priorize os indicadores desse módulo na sua resposta.`
        : "",
      "KPIS GLOBAIS DO TENANT:",
      JSON.stringify(input.globalMetrics),
      input.moduleMetrics
        ? `KPIS DETALHADOS DO MÓDULO ${input.moduleMetrics.module}:\n${JSON.stringify(input.moduleMetrics.metrics)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    if (aiEnv.geminiApiKey) {
      const model = aiEnv.geminiModel || FAST_MODULE_ANALYSIS_MODEL;
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      const contents = [
        ...input.history.slice(-10).map((item) => ({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: item.content }],
        })),
        { role: "user", parts: [{ text: input.message }] },
      ];

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": aiEnv.geminiApiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: { temperature: 0.35 },
          }),
          signal: AbortSignal.timeout(25_000),
        });

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let streamedAny = false;
          let usage: AiUsageTokens = {
            model,
            promptTokens: 0,
            completionTokens: 0,
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const jsonPayload = trimmed.slice(5).trim();
              if (!jsonPayload || jsonPayload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(
                  jsonPayload,
                ) as GeminiGenerateContentResponse;
                const chunkText =
                  parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (chunkText) {
                  streamedAny = true;
                  yield { type: "chunk", text: chunkText };
                }
                if (parsed.usageMetadata) {
                  usage = {
                    model,
                    promptTokens:
                      parsed.usageMetadata.promptTokenCount ??
                      usage.promptTokens,
                    completionTokens:
                      parsed.usageMetadata.candidatesTokenCount ??
                      usage.completionTokens,
                  };
                }
              } catch {
                // Ignora frame SSE parcial
              }
            }
          }

          if (streamedAny) {
            yield { type: "usage", usage };
            return;
          }
        }
      } catch {
        // Cai para streaming local estruturado
      }
    }

    // Fallback analítico local transmitido palavra por palavra para manter o contrato SSE.
    const localReply = buildLocalBusinessCopilotReply({
      message: input.message,
      history: input.history,
      metrics: input.globalMetrics,
    });
    const tokens = localReply.reply.split(/(\s+)/).filter(Boolean);
    for (const token of tokens) {
      yield { type: "chunk", text: token };
    }
    yield {
      type: "usage",
      usage: {
        model: "local-analytics",
        promptTokens: 0,
        completionTokens: 0,
      },
    };
  }
}
