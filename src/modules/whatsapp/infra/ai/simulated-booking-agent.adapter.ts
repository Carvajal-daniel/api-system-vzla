import type {
  AiBookingAgentInput,
  AiBookingAgentOutput,
  AiBookingAgentPort,
  AiExecutedToolAction,
} from "../../application/ports/ai-booking-agent.port.js";

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatPriceBRL(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function formatTimeInTimezone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function resolveTargetDate(text: string, now: Date, timezone: string): string {
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit?.[1]) return explicit[1];

  const brDate = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (brDate?.[1] && brDate?.[2]) {
    const year = brDate[3] ?? String(now.getUTCFullYear());
    const month = brDate[2].padStart(2, "0");
    const day = brDate[1].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (text.includes("amanha")) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return formatDateInTimezone(tomorrow, timezone);
  }

  return formatDateInTimezone(now, timezone);
}

function extractRequestedHour(text: string): string | null {
  const match = text.match(/\b([01]?\d|2[0-3])(?:[:h]([0-5]\d))?\s*(?:h|hrs|horas)?\b/);
  if (!match?.[1]) return null;
  // Evita capturar datas ou telefones acidentalmente se não tiver indicador de hora ou dois pontos
  const raw = match[0];
  if (!raw.includes(":") && !raw.includes("h") && !text.includes("as ")) {
    return null;
  }
  const hour = match[1].padStart(2, "0");
  const minute = (match[2] ?? "00").padStart(2, "0");
  return `${hour}:${minute}`;
}

// Adaptador determinístico de fallback quando OPENAI_API_KEY e GEMINI_API_KEY não estão configuradas.
// Usa os casos de uso reais da barbearia para que o fluxo completo de consulta e agendamento possa ser testado localmente sem custo.
export class SimulatedBookingAgentAdapter implements AiBookingAgentPort {
  async generateReply(
    input: AiBookingAgentInput,
  ): Promise<AiBookingAgentOutput> {
    const actions: AiExecutedToolAction[] = [];
    const normalized = normalizeText(input.latestClientMessage);
    const { company, client, tools } = input;

    // 1. Intenção de cancelamento ou consulta dos próprios agendamentos (sem jamais pedir UUID ao cliente)
    const asksCancel =
      normalized.includes("cancelar") || normalized.includes("desmarcar");
    const asksMyAppointments =
      normalized.includes("meus agendamentos") ||
      normalized.includes("meu agendamento") ||
      normalized.includes("meus horarios");

    if (asksCancel || asksMyAppointments) {
      const { appointments } = await tools.listCustomerUpcomingAppointments();
      actions.push({
        tool: "consultar_meus_agendamentos",
        input: {},
        ok: true,
        summary: `${appointments.length} agendamento(s) futuro(s) encontrado(s).`,
        data: { appointments },
      });

      if (appointments.length === 0) {
        return {
          replyText: client.name
            ? `Não encontrei agendamentos ativos para este número no momento, ${client.name}. Se quiser marcar um novo horário, é só me avisar!`
            : "Não encontrei agendamentos ativos para este número no momento. Se quiser marcar um novo horário, é só me avisar!",
          provider: "SIMULATED",
          actions,
        };
      }

      if (asksCancel && appointments.length === 1) {
        const target = appointments[0]!;
        try {
          const cancelled = await tools.cancelAppointment({
            appointmentId: target.appointmentId,
            cancellationReason: "Cancelado pelo cliente via WhatsApp IA",
          });
          actions.push({
            tool: "cancelar_agendamento",
            input: { appointmentId: target.appointmentId },
            ok: true,
            summary: `Agendamento ${cancelled.id} cancelado.`,
            data: cancelled,
          });
          return {
            replyText: `${client.name ? `Tudo certo, ${client.name}!` : "Tudo certo!"} Seu agendamento de ${target.serviceName} com ${target.collaboratorName} em ${target.localDate} às ${target.localTime} foi cancelado com sucesso. Se quiser remarcar para outro dia, é só me avisar.`,
            provider: "SIMULATED",
            actions,
          };
        } catch (error) {
          actions.push({
            tool: "cancelar_agendamento",
            input: { appointmentId: target.appointmentId },
            ok: false,
            summary: error instanceof Error ? error.message : "Erro ao cancelar",
          });
          return {
            replyText: `Não consegui cancelar seu agendamento de ${target.serviceName} (${target.localDate} às ${target.localTime}). Pode tentar novamente em instantes?`,
            provider: "SIMULATED",
            actions,
          };
        }
      }

      const listText = appointments
        .map(
          (item, index) =>
            `${index + 1}. ${item.localDate} às ${item.localTime} — ${item.serviceName} com ${item.collaboratorName}`,
        )
        .join("\n");

      return {
        replyText: asksCancel
          ? `Encontrei estes agendamentos futuros no seu número:\n${listText}\n\nQual deles você gostaria de cancelar?`
          : `Aqui estão seus próximos agendamentos ativos:\n${listText}\n\nSe quiser cancelar ou reagendar algum deles, é só me dizer!`,
        provider: "SIMULATED",
        actions,
      };
    }

    // 2. Consulta catálogo real se pedir serviços/preços/profissionais ou para resolver serviço
    const catalog = await tools.listServicesAndProfessionals();
    const matchedService =
      catalog.services.find((service) =>
        normalized.includes(normalizeText(service.name)),
      ) ?? catalog.services[0];

    const matchedCollaborator = catalog.collaborators.find((collab) =>
      normalized.includes(normalizeText(collab.name.split(" ")[0] ?? collab.name)),
    );

    const asksCatalog =
      normalized.includes("servico") ||
      normalized.includes("preco") ||
      normalized.includes("valor") ||
      normalized.includes("profission") ||
      normalized.includes("barbeir") ||
      normalized.includes("tabela");

    const asksBooking =
      normalized.includes("agendar") ||
      normalized.includes("marcar") ||
      normalized.includes("confirmar") ||
      normalized.includes("quero") ||
      normalized.includes("reservar");

    const asksAvailability =
      normalized.includes("horario") ||
      normalized.includes("disponiv") ||
      normalized.includes("livre") ||
      normalized.includes("agenda") ||
      normalized.includes("hoje") ||
      normalized.includes("amanha");

    if (asksCatalog && !asksBooking && !asksAvailability) {
      actions.push({
        tool: "listar_servicos_e_profissionais",
        input: {},
        ok: true,
        summary: `${catalog.services.length} serviço(s) e ${catalog.collaborators.length} profissional(is) listados.`,
        data: catalog,
      });

      if (catalog.services.length === 0) {
        return {
          replyText: `${client.name ? `Olá, ${client.name}!` : "Olá! Tudo bem?"} No momento ainda não há serviços ativos cadastrados em ${company.companyName}. Posso te chamar um atendente humano?`,
          provider: "SIMULATED",
          actions,
        };
      }

      const servicesList = catalog.services
        .slice(0, 6)
        .map(
          (s) =>
            `• ${s.name} — ${formatPriceBRL(s.priceInCents)} (${s.durationMinutes} min)`,
        )
        .join("\n");

      const teamList =
        catalog.collaborators.length > 0
          ? `\n\nProfissionais disponíveis: ${catalog.collaborators.map((c) => c.name).join(", ")}.`
          : "";

      return {
        replyText: `Aqui estão os serviços da ${company.companyName}:\n${servicesList}${teamList}\n\nQual serviço e dia você prefere para eu consultar os horários livres?`,
        provider: "SIMULATED",
        actions,
      };
    }

    // 3. Consulta disponibilidade ou realiza agendamento real na agenda
    if ((asksAvailability || asksBooking) && matchedService) {
      const targetDate = resolveTargetDate(normalized, input.now, company.timezone);
      const requestedHour = extractRequestedHour(normalized);

      let availability: Awaited<ReturnType<typeof tools.checkAvailability>>;
      try {
        availability = await tools.checkAvailability({
          serviceId: matchedService.id,
          date: targetDate,
          collaboratorId: matchedCollaborator?.id,
        });
        actions.push({
          tool: "consultar_horarios_livres",
          input: {
            serviceId: matchedService.id,
            date: targetDate,
            collaboratorId: matchedCollaborator?.id,
          },
          ok: true,
          summary: `${availability.slots.length} horário(s) encontrado(s) para ${targetDate}.`,
          data: { totalSlots: availability.slots.length, date: targetDate },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao consultar agenda.";
        actions.push({
          tool: "consultar_horarios_livres",
          input: { serviceId: matchedService.id, date: targetDate },
          ok: false,
          summary: message,
        });
        return {
          replyText: `Não consegui consultar os horários para ${targetDate} (${message}). Pode me informar outra data?`,
          provider: "SIMULATED",
          actions,
        };
      }

      if (availability.slots.length === 0) {
        return {
          replyText: `Não encontrei horários livres para ${matchedService.name} em ${targetDate}. Quer que eu verifique outra data (por exemplo, amanhã)?`,
          provider: "SIMULATED",
          actions,
        };
      }

      // Se o cliente pediu para agendar/confirmar (com hora específica ou aceitando o primeiro horário)
      if (asksBooking) {
        const chosenSlot = requestedHour
          ? availability.slots.find(
              (slot) =>
                formatTimeInTimezone(slot.startsAt, company.timezone) ===
                requestedHour,
            ) ?? availability.slots[0]!
          : availability.slots[0]!;

        try {
          const created = await tools.createAppointment({
            serviceId: matchedService.id,
            collaboratorId: chosenSlot.collaboratorId,
            startsAt: chosenSlot.startsAt,
            clientName: client.name ?? undefined,
            notes: "Agendado automaticamente via WhatsApp IA (Simulador)",
          });

          if (created.success === false) {
            actions.push({
              tool: "criar_agendamento",
              input: {
                serviceId: matchedService.id,
                collaboratorId: chosenSlot.collaboratorId,
                startsAt: chosenSlot.startsAt,
              },
              ok: false,
              summary: created.error,
              data: created,
            });
            const alternatives = created.availableSlots
              .slice(0, 4)
              .map((s) => s.localTime ?? formatTimeInTimezone(s.startsAt, company.timezone))
              .join(", ");
            return {
              replyText: `${created.error}.${alternatives ? ` Os horários livres disponíveis são: ${alternatives}.` : ""} Qual você prefere?`,
              provider: "SIMULATED",
              actions,
            };
          }

          actions.push({
            tool: "criar_agendamento",
            input: {
              serviceId: matchedService.id,
              collaboratorId: chosenSlot.collaboratorId,
              startsAt: chosenSlot.startsAt,
            },
            ok: true,
            summary: `Agendamento ${created.id} criado para ${chosenSlot.startsAt}.`,
            data: created,
          });

          const localTime = formatTimeInTimezone(
            created.startsAt,
            company.timezone,
          );
          return {
            replyText: `Agendamento confirmado na ${company.companyName}! ✂️\n• Serviço: ${created.serviceName}\n• Profissional: ${chosenSlot.collaboratorName}\n• Data: ${targetDate} às ${localTime}\n\nSe precisar reagendar ou cancelar, é só mandar mensagem por aqui.`,
            provider: "SIMULATED",
            actions,
            converted: true,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Erro ao criar agendamento.";
          actions.push({
            tool: "criar_agendamento",
            input: {
              serviceId: matchedService.id,
              collaboratorId: chosenSlot.collaboratorId,
              startsAt: chosenSlot.startsAt,
            },
            ok: false,
            summary: message,
          });
          return {
            replyText: `Tentei reservar esse horário, mas houve um imprevisto: ${message}. Posso verificar outro horário para você?`,
            provider: "SIMULATED",
            actions,
          };
        }
      }

      const previewSlots = availability.slots
        .slice(0, 5)
        .map(
          (slot) =>
            `• ${formatTimeInTimezone(slot.startsAt, company.timezone)} com ${slot.collaboratorName}`,
        )
        .join("\n");

      return {
        replyText: `Para ${matchedService.name} em ${targetDate}, temos estes horários livres:\n${previewSlots}\n\nSe quiser confirmar algum deles, basta responder "Quero agendar às ${formatTimeInTimezone(availability.slots[0]!.startsAt, company.timezone)}"!`,
        provider: "SIMULATED",
        actions,
      };
    }

    // 4. Saudação ou fallback cordial
    return {
      replyText: `${client.name ? `Olá, ${client.name}! 👋` : "Olá! Tudo bem? 👋"} Sou o assistente virtual da ${company.companyName}. Posso te mostrar nossos serviços e preços, consultar horários livres ou já agendar seu atendimento. Como posso te ajudar hoje?`,
      provider: "SIMULATED",
      actions,
    };
  }
}
