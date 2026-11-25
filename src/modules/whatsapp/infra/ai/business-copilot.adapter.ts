import { getAiEnv } from "../../../../shared/config/env.js";
import type {
  BusinessCopilotInput,
  BusinessCopilotOutput,
  BusinessCopilotPort,
} from "../../application/ports/business-copilot.port.js";
import type { BusinessMetricsSnapshot } from "../../application/ports/business-metrics-provider.port.js";
import { fetchGeminiGenerateContentWithFallback } from "./gemini-request-with-fallback.js";

function formatCurrencyBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function translateObjection(code: string): string {
  switch (code) {
    case "PRICE":
      return "Preço / Valor";
    case "SCHEDULE_FULL":
      return "Agenda Cheia";
    case "TIMING":
      return "Momento / Horário";
    case "PAYMENT_METHOD":
      return "Forma de Pagamento";
    case "OTHER":
      return "Outras objeções";
    default:
      return "Nenhuma objeção dominante";
  }
}

// Motor analítico local estruturado: gera respostas precisas com os números reais da empresa
// quando não há chave OpenAI/Gemini no .env ou em caso de erro de rede.
export function buildLocalBusinessCopilotReply(
  input: BusinessCopilotInput,
): BusinessCopilotOutput {
  const normalized = input.message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const m = input.metrics;

  const isFinanceQuery =
    /(faturamento|receita|dinheiro|caixa|comanda|comissao|comissoes|venda|lucro|pagar)/i.test(
      normalized,
    );
  const isAgendaQuery =
    /(agenda|agendamento|horario|cancelamento|no-show|falta|atendimento|hoje)/i.test(
      normalized,
    );
  const isWhatsappQuery =
    /(whatsapp|conversa|lead|conversao|funil|objecao|follow|parada)/i.test(
      normalized,
    );
  const isClientsQuery =
    /(cliente|inativo|retencao|recupera|retorno|sumido)/i.test(normalized);

  const sections: string[] = [];

  if (isFinanceQuery) {
    sections.push(
      `💰 **Financeiro (${m.companyName})**\n• Faturamento de hoje: **${formatCurrencyBrl(m.revenue.todayCents)}**\n• Faturamento acumulado no mês: **${formatCurrencyBrl(m.revenue.monthCents)}**\n• Comandas abertas: **${m.revenue.openOrdersCount}** (total de **${formatCurrencyBrl(m.revenue.openOrdersTotalCents)}**)\n• Comissões pendentes de repasse: **${m.commissions.pendingCount}** itens (**${formatCurrencyBrl(m.commissions.pendingTotalCents)}**)`,
    );
  }

  if (isAgendaQuery) {
    const cancelRate =
      m.appointments.monthTotal > 0
        ? Math.round(
            ((m.appointments.monthCanceled + m.appointments.monthNoShow) /
              m.appointments.monthTotal) *
              100,
          )
        : 0;
    sections.push(
      `📅 **Agenda & Operação**\n• Hoje: **${m.appointments.todayTotal}** agendamentos ativos (**${m.appointments.todayConfirmed}** confirmados, **${m.appointments.todayCompleted}** concluídos)\n• No mês: **${m.appointments.monthTotal}** agendamentos (**${m.appointments.monthCompleted}** concluídos, **${m.appointments.monthCanceled}** cancelados, **${m.appointments.monthNoShow}** faltas — taxa de perda de **${cancelRate}%**)`,
    );
  }

  if (isWhatsappQuery) {
    sections.push(
      `💬 **WhatsApp Intelligence (últimos 30 dias)**\n• Conversas iniciadas: **${m.whatsapp.totalConversations30d}**\n• Conversões em agendamento: **${m.whatsapp.convertedConversations30d}** (**${m.whatsapp.conversionRatePercent}%**)\n• Leads quentes identificados: **${m.whatsapp.hotLeadsCount}**\n• Conversas paradas há >24h: **${m.whatsapp.stalledConversations24h}**\n• Principal objeção detectada: **${translateObjection(m.whatsapp.topObjection)}**`,
    );
  }

  if (isClientsQuery) {
    sections.push(
      `👥 **Base & Retenção de Clientes**\n• Total de clientes cadastrados: **${m.clients.totalClients}**\n• Clientes inativos (>30 dias sem visita): **${m.clients.inactive30dCount}**`,
    );
  }

  if (sections.length === 0) {
    sections.push(
      `📊 **Resumo Executivo — ${m.companyName} (${m.referenceDate})**\n• **Financeiro:** ${formatCurrencyBrl(m.revenue.todayCents)} hoje | ${formatCurrencyBrl(m.revenue.monthCents)} no mês | ${m.revenue.openOrdersCount} comandas abertas.\n• **Agenda:** ${m.appointments.todayTotal} atendimentos hoje (${m.appointments.monthCompleted} concluídos no mês).\n• **Comissões pendentes:** ${formatCurrencyBrl(m.commissions.pendingTotalCents)} (${m.commissions.pendingCount} lançamentos).\n• **Clientes:** ${m.clients.totalClients} na base (${m.clients.inactive30dCount} inativos há +30 dias).\n• **WhatsApp (30d):** ${m.whatsapp.totalConversations30d} conversas, ${m.whatsapp.conversionRatePercent}% de conversão e ${m.whatsapp.stalledConversations24h} conversas paradas (>24h).`,
    );
  }

  // Recomendação prática baseada nos números reais
  const recommendations: string[] = [];
  if (m.whatsapp.stalledConversations24h > 0) {
    recommendations.push(
      `Acione o follow-up em 1 clique nas **${m.whatsapp.stalledConversations24h} conversas paradas** em *WhatsApp Intelligence* para recuperar agendamentos rápidos.`,
    );
  }
  if (m.revenue.openOrdersCount > 0) {
    recommendations.push(
      `Feche as **${m.revenue.openOrdersCount} comandas abertas** (${formatCurrencyBrl(m.revenue.openOrdersTotalCents)}) para manter o caixa do dia conciliado.`,
    );
  }
  if (m.clients.inactive30dCount > 0) {
    recommendations.push(
      `Há **${m.clients.inactive30dCount} clientes inativos** (+30 dias) com alto potencial de retorno via campanha de reativação.`,
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Sua operação está bem equilibrada hoje. Vale acompanhar os leads quentes do WhatsApp para preencher eventuais horários livres da semana.",
    );
  }

  const reply = `${sections.join("\n\n")}\n\n💡 **Próxima ação recomendada:**\n${recommendations.map((r) => `• ${r}`).join("\n")}`;

  return {
    reply,
    provider: "LOCAL_ANALYTICS",
    suggestedFollowups: [
      "Como está meu faturamento e comandas abertas hoje?",
      "Qual a taxa de conversão e objeções do WhatsApp?",
      "Quantos clientes inativos posso recuperar este mês?",
    ],
  };
}

function buildMetricsSystemPrompt(metrics: BusinessMetricsSnapshot): string {
  return [
    `Você é o Copiloto IA de Gestão da empresa "${metrics.companyName}".`,
    "Responda em português do Brasil de forma objetiva, consultiva e baseada EXCLUSIVAMENTE nas métricas reais abaixo.",
    "Nunca invente números. Se um dado for zero, informe com clareza e sugira ações práticas.",
    "",
    "MÉTRICAS REAIS DA EMPRESA (isoladas por tenant):",
    JSON.stringify(metrics, null, 2),
  ].join("\n");
}

// Adaptador resiliente do Copiloto IA: usa OpenAI ou Gemini com injeção das métricas reais,
// e cai automaticamente para o motor analítico local estruturado quando não houver chave no .env.
export class ResilientBusinessCopilotAdapter implements BusinessCopilotPort {
  async answer(input: BusinessCopilotInput): Promise<BusinessCopilotOutput> {
    const localFallback = buildLocalBusinessCopilotReply(input);
    const aiEnv = getAiEnv();
    const openAiKey = aiEnv.openAiApiKey;
    const geminiKey = aiEnv.geminiApiKey;

    if (!openAiKey && !geminiKey) {
      return localFallback;
    }

    const systemPrompt = buildMetricsSystemPrompt(input.metrics);
    const trimmedHistory = input.history.slice(-10);

    if (openAiKey) {
      try {
        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${openAiKey}`,
            },
            body: JSON.stringify({
              model: aiEnv.openAiModel,
              temperature: 0.35,
              messages: [
                { role: "system", content: systemPrompt },
                ...trimmedHistory.map((item) => ({
                  role: item.role,
                  content: item.content,
                })),
                { role: "user", content: input.message },
              ],
            }),
            signal: AbortSignal.timeout(15_000),
          },
        );

        if (response.ok) {
          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const reply = data.choices?.[0]?.message?.content?.trim();
          if (reply) {
            return {
              reply,
              provider: "OPENAI",
              suggestedFollowups: localFallback.suggestedFollowups,
            };
          }
        }
      } catch {
        // Fallback silencioso para próximo provedor ou motor analítico local
      }
    }

    if (geminiKey) {
      try {
        const contents = [
          ...trimmedHistory.map((item) => ({
            role: item.role === "assistant" ? "model" : "user",
            parts: [{ text: item.content }],
          })),
          { role: "user", parts: [{ text: input.message }] },
        ];

        const { response } = await fetchGeminiGenerateContentWithFallback({
          apiKey: geminiKey,
          primaryModel: aiEnv.geminiModel,
          fallbackModel: aiEnv.geminiFallbackModel,
          timeoutMs: 15_000,
          body: {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { temperature: 0.35 },
          },
        });

        if (response.ok) {
          const data = (await response.json()) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
          };
          const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (reply) {
            return {
              reply,
              provider: "GEMINI",
              suggestedFollowups: localFallback.suggestedFollowups,
            };
          }
        }
      } catch {
        // Fallback para motor analítico local
      }
    }

    return localFallback;
  }
}
