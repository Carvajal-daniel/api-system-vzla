import { getAiEnv } from "../../../../shared/config/env.js";
import type {
  ConversationAnalysisInput,
  ConversationAnalysisOutput,
  ConversationAnalyzerPort,
} from "../../application/ports/conversation-analyzer.port.js";
import type {
  DetectedObjection,
  LeadTemperature,
} from "../../domain/entities/ai-conversation-insight.entity.js";
import { fetchGeminiGenerateContentWithFallback } from "./gemini-request-with-fallback.js";

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function firstName(contactName: string | null): string {
  const clean = contactName?.trim();
  if (!clean) return "tudo bem";
  return clean.split(/\s+/)[0] ?? clean;
}

// Analisador heurístico local: garante inteligência comercial imediata mesmo sem chave externa no .env
// ou quando houver falha transitória na API da OpenAI/Gemini.
export function analyzeConversationHeuristically(
  input: ConversationAnalysisInput,
): ConversationAnalysisOutput {
  const clientMessages = input.messages
    .filter((msg) => msg.direction === "INBOUND")
    .map((msg) => msg.content);
  const allText = normalizeText(input.messages.map((m) => m.content).join(" "));
  const clientText = normalizeText(clientMessages.join(" "));
  const greetingName = firstName(input.contactName);

  const hasConfirmedAppointment =
    input.currentStatus === "CONVERTED" ||
    /(agendamento confirmado|agendado com sucesso|horario reservado|confirmado para|reserva confirmada|nos vemos|te esperamos|cita confirmada)/i.test(
      allText,
    );

  if (hasConfirmedAppointment) {
    return {
      leadTemperature: "HOT",
      leadScore: 95,
      summary: `Cliente ${input.contactName ?? input.phone} concluiu a conversa com agendamento confirmado.`,
      detectedObjection: "NONE",
      recommendedNextAction:
        "Enviar lembrete automático antes do horário e preparar o atendimento.",
      suggestedFollowupReply: `Olá${input.contactName ? `, ${greetingName}` : ""}! Passando só para confirmar que seu horário está garantido. Se precisar de qualquer ajuste, é só me avisar por aqui!`,
      appointmentConfirmed: true,
      provider: "HEURISTIC",
    };
  }

  // Detecção de objeções comerciais prioritárias
  let detectedObjection: DetectedObjection = "NONE";
  let objectionNote = "";

  if (
    /(caro|valor|preco|quanto custa|desconto|promocao|barato|muito alto|pesado|orcamento)/i.test(
      clientText,
    )
  ) {
    detectedObjection = "PRICE";
    objectionNote = "demonstrou sensibilidade a preço ou perguntou sobre valores/desconto";
  } else if (
    /(lotado|sem vaga|sem horario|cheio|cheia|nao tem horario|nao tem vaga|agenda cheia)/i.test(
      allText,
    )
  ) {
    detectedObjection = "SCHEDULE_FULL";
    objectionNote = "encontrou dificuldade para encaixar o horário desejado na agenda";
  } else if (
    /(pix|cartao|credito|debito|parcela|dinheiro|forma de pagamento|aceita)/i.test(
      clientText,
    )
  ) {
    detectedObjection = "PAYMENT_METHOD";
    objectionNote = "teve dúvida sobre formas de pagamento aceitas";
  } else if (
    /(depois|outra semana|mes que vem|vou ver|te aviso|correria|sem tempo|mais tarde|pensar|confirmar com)/i.test(
      clientText,
    )
  ) {
    detectedObjection = "TIMING";
    objectionNote = "pediu para ver depois ou ainda está decidindo o melhor momento";
  } else if (
    /(cancelar|desmarcar|nao vou conseguir|nao quero|deixa pra la|longe|endereco)/i.test(
      clientText,
    )
  ) {
    detectedObjection = "OTHER";
    objectionNote = "sinalizou uma barreira operacional ou desistência momentânea";
  }

  const hasStrongBookingIntent =
    /(agendar|marcar|horario|hoje|amanha|sabado|sexta|corte|barba|sobrancelha|escova|manicure|disponivel|vaga)/i.test(
      clientText,
    );

  let leadScore = 52;
  if (hasStrongBookingIntent) leadScore += 24;
  if (clientMessages.length >= 2) leadScore += 8;
  if (detectedObjection === "PRICE") leadScore -= 8;
  if (detectedObjection === "SCHEDULE_FULL") leadScore += 4; // quer agendar mas faltou vaga
  if (detectedObjection === "PAYMENT_METHOD") leadScore += 10;
  if (detectedObjection === "TIMING") leadScore -= 18;
  if (detectedObjection === "OTHER") leadScore -= 25;
  if (clientMessages.length === 0) leadScore = 35;

  leadScore = Math.max(10, Math.min(92, leadScore));

  let leadTemperature: LeadTemperature = "WARM";
  if (leadScore >= 75) {
    leadTemperature = "HOT";
  } else if (leadScore < 45) {
    leadTemperature = "COLD";
  }

  const summary = objectionNote
    ? `Cliente ${input.contactName ?? input.phone} interagiu pelo WhatsApp e ${objectionNote}.`
    : hasStrongBookingIntent
      ? `Cliente ${input.contactName ?? input.phone} demonstrou interesse ativo em agendar um serviço.`
      : `Cliente ${input.contactName ?? input.phone} iniciou contato e aguarda condução para agendamento.`;

  const actionByObjection: Record<DetectedObjection, string> = {
    NONE: "Oferecer dois horários objetivos para fechar o agendamento ainda hoje.",
    PRICE:
      "Reforçar o diferencial do atendimento ou oferecer um combo/serviço de entrada.",
    SCHEDULE_FULL:
      "Propor horário alternativo próximo ou incluir o cliente na lista prioritária de encaixe.",
    PAYMENT_METHOD:
      "Esclarecer as formas de pagamento aceitas (Pix, cartão e dinheiro) e concluir a reserva.",
    TIMING:
      "Fazer follow-up leve sugerindo horários flexíveis para os próximos dias.",
    OTHER:
      "Entender o motivo da pausa e manter a porta aberta com atendimento humanizado.",
  };

  const replyByObjection: Record<DetectedObjection, string> = {
    NONE: `Olá${input.contactName ? `, ${greetingName}` : ""}! Vi que você estava interessado em agendar conosco. Tenho ótimos horários disponíveis nos próximos dias — prefere manhã ou tarde?`,
    PRICE: `Olá${input.contactName ? `, ${greetingName}` : ""}! Tudo bem? Podemos montar uma opção que caiba certinho no que você procura, mantendo toda a qualidade do nosso atendimento. Quer que eu te passe as opções disponíveis?`,
    SCHEDULE_FULL: `Olá${input.contactName ? `, ${greetingName}` : ""}! Consegui verificar nossa agenda e posso tentar um encaixe especial ou te oferecer o próximo horário livre. Qual período fica melhor para você?`,
    PAYMENT_METHOD: `Olá${input.contactName ? `, ${greetingName}` : ""}! Só confirmando: aceitamos Pix, cartão de crédito, débito e dinheiro. Posso reservar seu horário agora mesmo?`,
    TIMING: `Olá${input.contactName ? `, ${greetingName}` : ""}! Passando sem compromisso para saber se já ficou mais fácil encaixar seu atendimento nesta semana. Se quiser, já deixo um horário reservado para você!`,
    OTHER: `Olá${input.contactName ? `, ${greetingName}` : ""}! Tudo bem? Caso ainda queira agendar ou tirar qualquer dúvida sobre nossos serviços, estou por aqui para ajudar.`,
  };

  return {
    leadTemperature,
    leadScore,
    summary,
    detectedObjection,
    recommendedNextAction: actionByObjection[detectedObjection],
    suggestedFollowupReply: replyByObjection[detectedObjection],
    appointmentConfirmed: false,
    provider: "HEURISTIC",
  };
}

interface RawAiInsightJson {
  leadTemperature?: string;
  leadScore?: number;
  summary?: string;
  detectedObjection?: string;
  recommendedNextAction?: string;
  suggestedFollowupReply?: string;
  appointmentConfirmed?: boolean;
}

function parseStructuredInsightJson(
  rawText: string,
  provider: "OPENAI" | "GEMINI",
  fallback: ConversationAnalysisOutput,
): ConversationAnalysisOutput {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as RawAiInsightJson;
    const temp = (parsed.leadTemperature ?? "").toUpperCase();
    const objection = (parsed.detectedObjection ?? "").toUpperCase();

    const leadTemperature: LeadTemperature =
      temp === "HOT" || temp === "WARM" || temp === "COLD"
        ? temp
        : fallback.leadTemperature;

    const detectedObjection: DetectedObjection =
      objection === "NONE" ||
      objection === "TIMING" ||
      objection === "SCHEDULE_FULL" ||
      objection === "PRICE" ||
      objection === "PAYMENT_METHOD" ||
      objection === "OTHER"
        ? objection
        : fallback.detectedObjection;

    const appointmentConfirmed =
      typeof parsed.appointmentConfirmed === "boolean"
        ? parsed.appointmentConfirmed
        : fallback.appointmentConfirmed;

    const rawScore =
      typeof parsed.leadScore === "number" && Number.isFinite(parsed.leadScore)
        ? Math.max(0, Math.min(100, Math.round(parsed.leadScore)))
        : fallback.leadScore;

    return {
      leadTemperature: appointmentConfirmed ? "HOT" : leadTemperature,
      leadScore: appointmentConfirmed ? Math.max(90, rawScore) : rawScore,
      summary: parsed.summary?.trim() || fallback.summary,
      detectedObjection: appointmentConfirmed ? "NONE" : detectedObjection,
      recommendedNextAction:
        parsed.recommendedNextAction?.trim() || fallback.recommendedNextAction,
      suggestedFollowupReply:
        parsed.suggestedFollowupReply?.trim() || fallback.suggestedFollowupReply,
      appointmentConfirmed,
      provider,
    };
  } catch {
    return fallback;
  }
}

function buildAnalysisPrompt(input: ConversationAnalysisInput): string {
  const transcript = input.messages
    .slice(-18)
    .map(
      (msg) =>
        `[${msg.senderType}] (${msg.sentAt}): ${msg.content.replace(/\s+/g, " ").trim()}`,
    )
    .join("\n");

  return [
    "Analise a conversa de WhatsApp de uma barbearia/salão e retorne APENAS um JSON válido (sem markdown).",
    "Campos obrigatórios do JSON:",
    '- "leadTemperature": "HOT" | "WARM" | "COLD"',
    '- "leadScore": inteiro de 0 a 100',
    '- "summary": resumo objetivo em português (máx 180 caracteres)',
    '- "detectedObjection": "NONE" | "TIMING" | "SCHEDULE_FULL" | "PRICE" | "PAYMENT_METHOD" | "OTHER"',
    '- "recommendedNextAction": próxima ação prática para o dono (máx 160 caracteres)',
    '- "suggestedFollowupReply": mensagem cordial pronta para enviar no WhatsApp em português',
    '- "appointmentConfirmed": boolean (true somente se o agendamento já foi confirmado)',
    "",
    `Contato: ${input.contactName ?? "Não informado"} (${input.phone})`,
    `Status atual: ${input.currentStatus}`,
    "Histórico:",
    transcript || "(sem mensagens)",
  ].join("\n");
}

// Adaptador resiliente: usa OpenAI ou Gemini quando configurados no .env e cai automaticamente
// para o motor heurístico local caso não haja chave ou ocorra erro de rede/timeout.
export class ResilientConversationAnalyzerAdapter
  implements ConversationAnalyzerPort
{
  async analyze(
    input: ConversationAnalysisInput,
  ): Promise<ConversationAnalysisOutput> {
    const heuristicFallback = analyzeConversationHeuristically(input);

    const aiEnv = getAiEnv();
    const openAiKey = aiEnv.openAiApiKey;
    const geminiKey = aiEnv.geminiApiKey;

    if (!openAiKey && !geminiKey) {
      return heuristicFallback;
    }

    const prompt = buildAnalysisPrompt(input);

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
              temperature: 0.2,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content:
                    "Você é um analista comercial especialista em barbearias e salões de beleza. Responda somente JSON válido.",
                },
                { role: "user", content: prompt },
              ],
            }),
            signal: AbortSignal.timeout(12_000),
          },
        );

        if (response.ok) {
          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            return parseStructuredInsightJson(
              content,
              "OPENAI",
              heuristicFallback,
            );
          }
        }
      } catch {
        // Falha transitória na OpenAI: segue para fallback
      }
    }

    if (geminiKey) {
      try {
        const { response } = await fetchGeminiGenerateContentWithFallback({
          apiKey: geminiKey,
          primaryModel: aiEnv.geminiModel,
          fallbackModel: aiEnv.geminiFallbackModel,
          timeoutMs: 12_000,
          body: {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: "application/json",
            },
          },
        });

        if (response.ok) {
          const data = (await response.json()) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
          };
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (content) {
            return parseStructuredInsightJson(
              content,
              "GEMINI",
              heuristicFallback,
            );
          }
        }
      } catch {
        // Falha transitória na Gemini: segue para fallback heurístico
      }
    }

    return heuristicFallback;
  }
}
