import type {
  AiBookingAgentInput,
  AiBookingToolExecutor,
  AiExecutedToolAction,
} from "../../application/ports/ai-booking-agent.port.js";
import { getLocalDateTimeParts } from "../../../appointments/domain/services/timezone-utils.js";

export type AiToolName = AiExecutedToolAction["tool"];

export interface AiToolDefinition {
  name: AiToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      { type: string; description: string }
    >;
    required?: string[];
  };
}

export const AI_BOOKING_TOOL_DEFINITIONS: AiToolDefinition[] = [
  {
    name: "listar_servicos_e_profissionais",
    description:
      "Lista os serviços ativos (com preço em centavos e duração) e os profissionais ativos da empresa.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_horarios_livres",
    description:
      "Consulta os horários disponíveis na agenda real para um serviço em uma data específica (YYYY-MM-DD).",
    parameters: {
      type: "object",
      properties: {
        serviceId: {
          type: "string",
          description: "UUID do serviço desejado.",
        },
        date: {
          type: "string",
          description: "Data no formato YYYY-MM-DD (ex: 2026-11-25).",
        },
        collaboratorId: {
          type: "string",
          description: "UUID opcional do profissional escolhido pelo cliente.",
        },
      },
      required: ["serviceId", "date"],
    },
  },
  {
    name: "consultar_meus_agendamentos",
    description:
      "Localiza automaticamente os agendamentos futuros ativos (PENDING ou CONFIRMED) do cliente atual usando o telefone da conversa no WhatsApp. Use sempre antes de cancelar, reagendar ou informar horários já marcados do cliente.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "criar_agendamento",
    description:
      "Cria um agendamento real na agenda da empresa após confirmar serviço, profissional e horário livre.",
    parameters: {
      type: "object",
      properties: {
        serviceId: {
          type: "string",
          description: "UUID do serviço.",
        },
        collaboratorId: {
          type: "string",
          description: "UUID do profissional.",
        },
        startsAt: {
          type: "string",
          description:
            "Valor exato de startsAt (ISO-8601 UTC) copiado do slot retornado por consultar_horarios_livres cujo localDate e localTime correspondam ao pedido do cliente.",
        },
        localDate: {
          type: "string",
          description:
            "Data local exata do slot escolhido (YYYY-MM-DD, igual ao localDate do slot retornado por consultar_horarios_livres).",
        },
        localTime: {
          type: "string",
          description:
            "Horário local exato do slot escolhido (HH:MM, igual ao localTime do slot retornado por consultar_horarios_livres).",
        },
        clientName: {
          type: "string",
          description: "Nome do cliente (opcional, usa o contato da conversa se omitido).",
        },
        notes: {
          type: "string",
          description: "Observação opcional do agendamento.",
        },
      },
      required: ["serviceId", "collaboratorId", "startsAt", "localDate", "localTime"],
    },
  },
  {
    name: "reagendar_agendamento",
    description:
      "Reagenda um agendamento existente do cliente para uma nova data/hora ISO-8601.",
    parameters: {
      type: "object",
      properties: {
        appointmentId: {
          type: "string",
          description: "UUID do agendamento existente.",
        },
        startsAt: {
          type: "string",
          description: "Nova data e hora de início em ISO-8601.",
        },
        collaboratorId: {
          type: "string",
          description: "UUID opcional do novo profissional.",
        },
      },
      required: ["appointmentId", "startsAt"],
    },
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela um agendamento existente do cliente.",
    parameters: {
      type: "object",
      properties: {
        appointmentId: {
          type: "string",
          description: "UUID do agendamento a cancelar.",
        },
        cancellationReason: {
          type: "string",
          description: "Motivo do cancelamento informado pelo cliente.",
        },
      },
      required: ["appointmentId"],
    },
  },
  {
    name: "request_human_handoff",
    description:
      "Aciona o transbordo para um atendente humano/barbeiro sempre que o cliente pedir para falar com uma pessoa ou enviar uma solicitação que exija intervenção humana.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo resumido do pedido de atendimento humano.",
        },
      },
      required: ["reason"],
    },
  },
];

export function buildAiBookingSystemPrompt(input: AiBookingAgentInput): string {
  const servicesSummary =
    input.company.services.length > 0
      ? input.company.services
          .map(
            (s) =>
              `- ${s.name} (id: ${s.id}, preço: R$ ${(s.priceInCents / 100).toFixed(2)}, duração: ${s.durationMinutes} min)`,
          )
          .join("\n")
      : "- Nenhum serviço ativo listado no momento.";

  const collaboratorsSummary =
    input.company.collaborators.length > 0
      ? input.company.collaborators
          .map(
            (c) =>
              `- ${c.name} (id: ${c.id}${c.specialty ? `, especialidade: ${c.specialty}` : ""})`,
          )
          .join("\n")
      : "- Nenhum profissional ativo listado no momento.";

  const customPrompt = input.company.aiSystemPrompt?.trim()
    ? `\nInstruções personalizadas da empresa:\n${input.company.aiSystemPrompt.trim()}\n`
    : "";

  const rules = input.company.operationalRules;
  const operationalLines: string[] = [];
  if (rules?.address) operationalLines.push(`- Endereço: ${rules.address}`);
  if (rules?.googleMapsUrl) {
    operationalLines.push(`- Link do Google Maps: ${rules.googleMapsUrl}`);
  }
  if (rules?.paymentMethods) {
    operationalLines.push(`- Formas de pagamento: ${rules.paymentMethods}`);
  }
  if (rules?.delayPolicy) {
    operationalLines.push(`- Política de atraso/cancelamento: ${rules.delayPolicy}`);
  }
  if (rules?.packageNotes) {
    operationalLines.push(`- Pacotes/Assinaturas: ${rules.packageNotes}`);
  }
  const operationalSummary =
    operationalLines.length > 0
      ? `\nRegras operacionais da empresa:\n${operationalLines.join("\n")}\n`
      : "";

  const customerCtx = input.company.customerContext;
  const customerLines: string[] = [];
  if (customerCtx?.registeredName) {
    customerLines.push(`- Nome cadastrado: ${customerCtx.registeredName}`);
  }
  if (customerCtx?.lastCompletedVisit) {
    customerLines.push(
      `- Último atendimento concluído: ${customerCtx.lastCompletedVisit.serviceName} com ${customerCtx.lastCompletedVisit.collaboratorName} em ${customerCtx.lastCompletedVisit.localDate}`,
    );
  }
  if (customerCtx?.preferredCollaboratorName) {
    customerLines.push(
      `- Profissional preferido: ${customerCtx.preferredCollaboratorName}`,
    );
  }
  if (customerCtx?.activePackagesOrTags && customerCtx.activePackagesOrTags.length > 0) {
    customerLines.push(
      `- Pacotes/observações do cliente: ${customerCtx.activePackagesOrTags.join(", ")}`,
    );
  }
  if (customerCtx?.todayAppointments && customerCtx.todayAppointments.length > 0) {
    const todayList = customerCtx.todayAppointments
      .map(
        (appt) =>
          `${appt.localTime} (${appt.serviceName} com ${appt.collaboratorName}, status: ${appt.status})`,
      )
      .join("; ");
    customerLines.push(`- Agendamentos de hoje: ${todayList}`);
  }
  const customerSummary =
    customerLines.length > 0
      ? `\nPerfil e histórico do cliente:\n${customerLines.join("\n")}\n`
      : "";

  const localNow = getLocalDateTimeParts(input.now, input.company.timezone);
  const localNowFormatted = `${localNow.dateString} ${String(localNow.hour).padStart(2, "0")}:${String(localNow.minute).padStart(2, "0")}`;

  return [
    `Você é o assistente virtual de WhatsApp da empresa "${input.company.companyName}".`,
    `Data/hora local atual da empresa (${input.company.timezone}): ${localNowFormatted} | UTC: ${input.now.toISOString()}.`,
    `Cliente atual: ${input.client.name} (telefone: ${input.client.phone}).`,
    customerSummary,
    operationalSummary,
    customPrompt,
    "Regras de atendimento:",
    "1. Responda sempre em português claro, cordial, curto e natural para WhatsApp.",
    "2. NUNCA invente horários livres nem confirme um agendamento ao cliente sem antes executar a ferramenta criar_agendamento e receber success: true na resposta da ferramenta. Use SEMPRE os IDs (UUIDs) exatos retornados por listar_servicos_e_profissionais.",
    "3. OBRIGATÓRIO em qualquer pedido direto de agendamento (mesmo quando o cliente já informou serviço, profissional, data e hora): chame PRIMEIRO consultar_horarios_livres (informando collaboratorId quando o cliente escolheu um profissional), confira se existe na lista retornada um slot com localDate e localTime EXATAMENTE iguais ao pedido e SOMENTE DEPOIS chame criar_agendamento copiando literalmente o startsAt, localDate e localTime desse slot (NUNCA monte um horário UTC manualmente a partir da hora local).",
    "4. PROIBIDO inventar ou escolher horário alternativo sozinho: se o horário exato pedido pelo cliente NÃO estiver livre em consultar_horarios_livres — ou se criar_agendamento retornar success: false (ex.: 'Horário já ocupado na agenda') — NÃO confirme o agendamento nem tente reservar outro horário sem autorização; informe que o horário pedido está indisponível, liste os horários livres mais próximos retornados em slots/availableSlots (usando localTime) e aguarde o cliente escolher.",
    "5. Se faltar alguma informação (serviço, data ou preferência), pergunte de forma curta e amigável.",
    "6. Sempre que o cliente perguntar quem atende ou quais profissionais/barbeiros estão disponíveis, liste também os profissionais ativos junto com os serviços (aproveitando o retorno de listar_servicos_e_profissionais).",
    "7. Se o cliente pedir horários livres sem especificar o serviço (ex: \"quais horários tem amanhã à tarde?\"), consulte proativamente consultar_horarios_livres já na mesma interação usando o serviço mais comum do catálogo (ex: Corte Masculino ou o primeiro serviço ativo), informe claramente na resposta que os horários mostrados são baseados nesse serviço (usando sempre localTime) e pergunte qual serviço e profissional ele deseja confirmar.",
    "8. JAMAIS peça o ID (UUID) ou código do agendamento ao cliente. Sempre que o cliente pedir para cancelar, desmarcar, reagendar ou consultar seus horários marcados, chame PRIMEIRO consultar_meus_agendamentos (que usa automaticamente o telefone desta conversa):",
    "   - Se houver exatamente 1 agendamento futuro: identifique serviço, profissional, data e hora e execute diretamente cancelar_agendamento (ou confirme/execute reagendar_agendamento após checar consultar_horarios_livres) usando o appointmentId retornado.",
    "   - Se houver mais de 1 agendamento futuro: liste os agendamentos encontrados de forma amigável (data, hora, serviço e profissional) e pergunte qual deles o cliente deseja cancelar ou alterar.",
    "   - Se não houver nenhum agendamento futuro: informe educadamente que não encontrou agendamentos ativos para este número de WhatsApp.",
    "9. ESCOPO ESTRITO: Se o cliente falar sobre assuntos fora do escopo da barbearia/salão (política, piadas, programação, receitas, finanças, etc.), recuse educadamente em 1 frase curta e direcione de volta para agendamentos ou informações da loja.",
    "10. TRANSBORDO HUMANO: Sempre que o cliente pedir para falar com um atendente, barbeiro, gerente ou pessoa real — ou enviar uma reclamação/assunto que exija intervenção humana — chame obrigatoriamente a ferramenta request_human_handoff e avise que um atendente vai assumir em breve.",
    "",
    "Catálogo atual (resumo):",
    servicesSummary,
    "",
    "Profissionais ativos:",
    collaboratorsSummary,
  ].join("\n");
}

export async function dispatchAiBookingToolCall(
  toolName: string,
  rawArgs: Record<string, unknown>,
  tools: AiBookingToolExecutor,
  actions: AiExecutedToolAction[],
): Promise<{
  result: unknown;
  converted: boolean;
  handoffRequested?: { reason: string } | undefined;
}> {
  try {
    switch (toolName) {
      case "listar_servicos_e_profissionais": {
        const data = await tools.listServicesAndProfessionals();
        actions.push({
          tool: "listar_servicos_e_profissionais",
          input: rawArgs,
          ok: true,
          summary: `${data.services.length} serviço(s) e ${data.collaborators.length} profissional(is).`,
          data,
        });
        return { result: data, converted: false };
      }

      case "consultar_horarios_livres": {
        const serviceId = String(rawArgs.serviceId ?? "").trim();
        const date = String(rawArgs.date ?? "").trim();
        const collaboratorId = rawArgs.collaboratorId
          ? String(rawArgs.collaboratorId).trim() || undefined
          : undefined;
        const data = await tools.checkAvailability({
          serviceId,
          date,
          collaboratorId,
        });
        actions.push({
          tool: "consultar_horarios_livres",
          input: rawArgs,
          ok: true,
          summary: `${data.slots.length} horário(s) disponível(is) em ${date}.`,
          data: { date, totalSlots: data.slots.length },
        });
        return { result: data, converted: false };
      }

      case "consultar_meus_agendamentos": {
        const data = await tools.listCustomerUpcomingAppointments();
        actions.push({
          tool: "consultar_meus_agendamentos",
          input: rawArgs,
          ok: true,
          summary: `${data.appointments.length} agendamento(s) futuro(s) encontrado(s).`,
          data,
        });
        return { result: data, converted: false };
      }

      case "criar_agendamento": {
        const data = await tools.createAppointment({
          serviceId: String(rawArgs.serviceId ?? ""),
          collaboratorId: String(rawArgs.collaboratorId ?? ""),
          startsAt: String(rawArgs.startsAt ?? ""),
          localDate: rawArgs.localDate ? String(rawArgs.localDate) : undefined,
          localTime: rawArgs.localTime ? String(rawArgs.localTime) : undefined,
          clientName: rawArgs.clientName ? String(rawArgs.clientName) : undefined,
          notes: rawArgs.notes ? String(rawArgs.notes) : undefined,
        });
        if (data.success === false) {
          actions.push({
            tool: "criar_agendamento",
            input: rawArgs,
            ok: false,
            summary: data.error,
            data,
          });
          return { result: data, converted: false };
        }
        actions.push({
          tool: "criar_agendamento",
          input: rawArgs,
          ok: true,
          summary: `Agendamento ${data.id} criado.`,
          data,
        });
        return { result: { ...data, success: true }, converted: true };
      }

      case "reagendar_agendamento": {
        const data = await tools.rescheduleAppointment({
          appointmentId: String(rawArgs.appointmentId ?? ""),
          startsAt: String(rawArgs.startsAt ?? ""),
          collaboratorId: rawArgs.collaboratorId
            ? String(rawArgs.collaboratorId)
            : undefined,
        });
        actions.push({
          tool: "reagendar_agendamento",
          input: rawArgs,
          ok: true,
          summary: `Agendamento ${data.id} reagendado.`,
          data,
        });
        return { result: data, converted: true };
      }

      case "cancelar_agendamento": {
        const data = await tools.cancelAppointment({
          appointmentId: String(rawArgs.appointmentId ?? ""),
          cancellationReason: rawArgs.cancellationReason
            ? String(rawArgs.cancellationReason)
            : undefined,
        });
        actions.push({
          tool: "cancelar_agendamento",
          input: rawArgs,
          ok: true,
          summary: `Agendamento ${data.id} cancelado.`,
          data,
        });
        return { result: data, converted: false };
      }

      case "request_human_handoff": {
        const reason =
          String(rawArgs.reason ?? "").trim() ||
          "Cliente solicitou atendimento humano.";
        const data = tools.requestHumanHandoff
          ? await tools.requestHumanHandoff({ reason })
          : { handoff: true as const, reason };
        actions.push({
          tool: "request_human_handoff",
          input: rawArgs,
          ok: true,
          summary: `Transbordo humano solicitado: ${data.reason}`,
          data,
        });
        return {
          result: data,
          converted: false,
          handoffRequested: { reason: data.reason },
        };
      }

      default:
        return {
          result: { error: `Ferramenta desconhecida: ${toolName}` },
          converted: false,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao executar ferramenta.";
    if (
      toolName === "listar_servicos_e_profissionais" ||
      toolName === "consultar_horarios_livres" ||
      toolName === "consultar_meus_agendamentos" ||
      toolName === "criar_agendamento" ||
      toolName === "reagendar_agendamento" ||
      toolName === "cancelar_agendamento" ||
      toolName === "request_human_handoff"
    ) {
      actions.push({
        tool: toolName,
        input: rawArgs,
        ok: false,
        summary: message,
      });
    }
    return { result: { success: false, error: message }, converted: false };
  }
}
