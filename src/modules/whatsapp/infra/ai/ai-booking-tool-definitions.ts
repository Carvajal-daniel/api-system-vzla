import type {
  AiBookingAgentInput,
  AiBookingServiceCategoryGroup,
  AiBookingServiceSummary,
  AiBookingSubscriptionPlansResult,
  AiBookingToolExecutor,
  AiExecutedToolAction,
} from "../../application/ports/ai-booking-agent.port.js";
import { getLocalDateTimeParts } from "../../../appointments/domain/services/timezone-utils.js";

export type AiToolName = AiExecutedToolAction["tool"];

// Remove placeholders genéricos (ex.: "Cliente", "Cliente Teste", "Teste", "Test", números puros)
// para nunca exibir um nome artificial como "*Cliente*" na saudação ou gravar placeholder na agenda.
export function sanitizeCustomerName(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) return null;
  const normalized = trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    /^cliente(\s+(teste?|whatsapp|novo|padrao|default|\d+))*$/.test(normalized) ||
    /^teste?(\s+(cliente|usuario|user|contato|whatsapp|\d+))*$/.test(normalized) ||
    /^(whatsapp|contato|usuario|user)(\s+(teste?|\d+))*$/.test(normalized) ||
    /^\+?\d[\d\s()-]{4,}$/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

// Resolve o nome de exibição do cliente estritamente na ordem:
// nome cadastrado em `clients` -> `pushName` do WhatsApp -> `null`.
export function resolveCustomerDisplayName(input: {
  clientName?: string | null | undefined;
  pushName?: string | null | undefined;
}): string | null {
  return (
    sanitizeCustomerName(input.clientName) ??
    sanitizeCustomerName(input.pushName) ??
    null
  );
}

const SERVICE_CATEGORY_ORDER = [
  "Combos",
  "Cabelo",
  "Barba",
  "Sobrancelha & Estética",
  "Química & Tratamentos",
  "Planos & Assinaturas",
  "Outros",
] as const;

export function isSubscriptionPlanService(service: {
  name: string;
  description?: string | null | undefined;
}): boolean {
  const haystack = `${service.name} ${service.description ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(plano|planos|assinatura|assinaturas|clube|mensal|mensalidade|pacote|pacotes)\b/.test(
    haystack,
  );
}

// Infere uma categoria enxuta para agrupar serviços no WhatsApp mesmo sem coluna `category` na tabela `services`.
export function inferServiceCategory(service: {
  name: string;
  description?: string | null | undefined;
}): string {
  const haystack = `${service.name} ${service.description ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (isSubscriptionPlanService(service)) {
    return "Planos & Assinaturas";
  }
  if (
    haystack.includes("+") ||
    /\b(combo|completo|corte e barba|cabelo e barba|barba e cabelo)\b/.test(
      haystack,
    )
  ) {
    return "Combos";
  }
  if (
    /\b(luzes|platinado|pigmentacao|selagem|progressiva|alisamento|hidratacao|botox|tintura|coloracao|relaxamento|quimica|escova)\b/.test(
      haystack,
    )
  ) {
    return "Química & Tratamentos";
  }
  if (
    /\b(sobrancelha|limpeza|mascara|depilacao|cera|nariz|orelha|estetica|pele)\b/.test(
      haystack,
    )
  ) {
    return "Sobrancelha & Estética";
  }
  if (/\b(barba|bigode|navalha|barboterapia)\b/.test(haystack)) {
    return "Barba";
  }
  if (
    /\b(corte|cabelo|degrade|fade|social|maquina|tesoura|pezinho|acabamento|infantil|raspado|razor)\b/.test(
      haystack,
    )
  ) {
    return "Cabelo";
  }
  return "Outros";
}

export function groupServicesByCategory(
  services: AiBookingServiceSummary[],
): AiBookingServiceCategoryGroup[] {
  const grouped = new Map<string, AiBookingServiceSummary[]>();
  for (const service of services) {
    const category = service.category?.trim() || inferServiceCategory(service);
    const list = grouped.get(category) ?? [];
    list.push({ ...service, category });
    grouped.set(category, list);
  }

  const orderedCategories = [
    ...SERVICE_CATEGORY_ORDER.filter((cat) => grouped.has(cat)),
    ...Array.from(grouped.keys()).filter(
      (cat) =>
        !SERVICE_CATEGORY_ORDER.includes(
          cat as (typeof SERVICE_CATEGORY_ORDER)[number],
        ),
    ),
  ];

  return orderedCategories.map((category) => ({
    category,
    services: grouped.get(category) ?? [],
  }));
}

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
      "Lista o catálogo completo de serviços ativos agrupados por categoria (com preço em centavos e duração), profissionais ativos e eventuais planos de assinatura da empresa. Use quando o cliente pedir o catálogo completo (opção 2) ou perguntar por um serviço que não está no Top 3.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_planos_assinatura",
    description:
      "Consulta os planos de assinatura, clubes e pacotes recorrentes configurados para a empresa no banco de dados. Use sempre que o cliente pedir a opção de planos de assinatura (opção 3) ou perguntar sobre clube/assinatura mensal.",
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
  const nonPlanServices = input.company.services.filter(
    (s) => !isSubscriptionPlanService(s),
  );
  const topServicesPool =
    nonPlanServices.length > 0 ? nonPlanServices : input.company.services;
  const topThreeServices = topServicesPool.slice(0, 3);

  const topServicesSummary =
    topThreeServices.length > 0
      ? topThreeServices
          .map(
            (s) =>
              `- ${s.name} (id: ${s.id}, preço: R$ ${(s.priceInCents / 100).toFixed(2).replace(".", ",")}, duração: ${s.durationMinutes} min)`,
          )
          .join("\n")
      : "- Nenhum serviço ativo listado no momento.";

  const totalServicesCount = input.company.services.length;

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
  const hasVisitHistory = Boolean(
    customerCtx?.lastCompletedVisit ||
      customerCtx?.mostFrequentServiceName ||
      customerCtx?.preferredCollaboratorName ||
      (customerCtx?.totalVisits ?? 0) > 0,
  );
  const isNewCustomer = customerCtx?.isNewCustomer ?? !hasVisitHistory;

  const resolvedCustomerName = resolveCustomerDisplayName({
    clientName: customerCtx?.registeredName,
    pushName: input.client.name,
  });
  const customerFirstName = resolvedCustomerName
    ? resolvedCustomerName.split(/\s+/)[0] ?? null
    : null;

  const customerLines: string[] = [
    `- Tipo de cliente: ${
      isNewCustomer
        ? "Cliente NOVO (primeiro contato / sem atendimentos anteriores)"
        : "Cliente RECORRENTE (já é cliente da casa)"
    }`,
  ];
  if (resolvedCustomerName) {
    customerLines.push(`- Nome do cliente: ${resolvedCustomerName}`);
  } else {
    customerLines.push(
      `- Nome do cliente: não identificado (cumprimente apenas com "Olá! Tudo bem?" — NUNCA use "Cliente" ou "*Cliente*").`,
    );
  }
  if (customerCtx?.mostFrequentServiceName) {
    customerLines.push(
      `- Serviço mais frequente: ${customerCtx.mostFrequentServiceName}`,
    );
  }
  const preferredCollaborator = customerCtx?.preferredCollaboratorName
    ? input.company.collaborators.find(
        (c) =>
          c.name.trim().toLowerCase() ===
          customerCtx.preferredCollaboratorName!.trim().toLowerCase(),
      ) ?? null
    : null;

  if (customerCtx?.preferredCollaboratorName) {
    customerLines.push(
      preferredCollaborator
        ? `- Profissional preferido: ${customerCtx.preferredCollaboratorName} (id: ${preferredCollaborator.id})`
        : `- Profissional preferido: ${customerCtx.preferredCollaboratorName}`,
    );
  }
  if (customerCtx?.lastCompletedVisit) {
    customerLines.push(
      `- Último atendimento concluído: ${customerCtx.lastCompletedVisit.serviceName} com ${customerCtx.lastCompletedVisit.collaboratorName} em ${customerCtx.lastCompletedVisit.localDate}`,
    );
  }
  if (customerCtx?.habitualWeekday) {
    customerLines.push(
      `- Dia habitual: costuma cortar ${customerCtx.habitualWeekday}`,
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
  const customerSummary = `\nPerfil e histórico do cliente:\n${customerLines.join("\n")}\n`;

  const shortcutService =
    customerCtx?.mostFrequentServiceName ||
    customerCtx?.lastCompletedVisit?.serviceName ||
    null;
  const shortcutCollaborator =
    customerCtx?.preferredCollaboratorName ||
    customerCtx?.lastCompletedVisit?.collaboratorName ||
    null;
  const recurringHabitualLine =
    shortcutService && shortcutCollaborator
      ? `Mencione o histórico de forma natural e respeitosa, por exemplo: "Vi no seu histórico que você costuma fazer *${shortcutService}* com o *${shortcutCollaborator}*${customerCtx?.habitualWeekday ? ` (geralmente ${customerCtx.habitualWeekday})` : ""}."`
      : shortcutService
        ? `Mencione o histórico de forma natural e respeitosa, por exemplo: "Vi no seu histórico que você costuma fazer *${shortcutService}*${customerCtx?.habitualWeekday ? ` (geralmente ${customerCtx.habitualWeekday})` : ""}."`
        : "Mencione de forma natural e respeitosa que já conhece o perfil dele na casa.";

  const preferredBarberPriorityLine = customerCtx?.preferredCollaboratorName
    ? `- PRIORIDADE DO BARBEIRO HABITUAL (*${customerCtx.preferredCollaboratorName}*${preferredCollaborator ? `, id: ${preferredCollaborator.id}` : ""}): sempre que o cliente pedir um dia/horário sem pedir explicitamente outro profissional, consulte consultar_horarios_livres passando o collaboratorId desse profissional. Se o horário exato estiver ocupado, mostre PRIMEIRO todos os horários livres desse mesmo barbeiro no dia (ex.: "Para amanhã com o *${customerCtx.preferredCollaboratorName}*, o horário das 16:00 está ocupado, mas ele tem estes horários livres: *15:00*, *17:30*...") ANTES de oferecer outros barbeiros. Só sugira outro profissional se o cliente pedir para trocar ou se a agenda do *${customerCtx.preferredCollaboratorName}* estiver 100% lotada no dia.`
    : null;

  const greetingInstruction = customerFirstName
    ? `Cumprimente pelo primeiro nome (*${customerFirstName}*)`
    : 'Cumprimente apenas com "Olá! Tudo bem?" (NUNCA escreva "Cliente" ou "*Cliente*")';

  const customerJourneyGuidance = isNewCustomer
    ? [
        "Abordagem obrigatória para CLIENTE NOVO (isNewCustomer: true):",
        `- ${greetingInstruction} e dê boas-vindas acolhedoras à "${input.company.companyName}" com tom natural e respeitoso (use apenas emojis permitidos: ✂️, 💈, ⏰, ✅ ou 👊; PROIBIDO gírias forçadas como "mandar bem" ou "colar com a gente").`,
        "- NÃO liste todos os serviços na primeira mensagem. Mostre apenas os *3 principais serviços* (com preço) e os *profissionais da equipe*.",
        "- Apresente exatamente estas 4 opções claras para guiar o cliente:",
        '  1️⃣ *Agendar um horário* (diga o serviço, barbeiro ou "tanto faz", e o dia/hora)',
        "  2️⃣ *Ver catálogo completo de serviços*",
        "  3️⃣ *Conhecer nossos planos de assinatura* 👑",
        "  4️⃣ *Falar com um atendente*",
        "- Se a resposta ao menu inicial for 1 (Agendar um horário) e o cliente ainda não tiver escolhido o serviço, pergunte qual ele quer. Liste até os 3 principais serviços abaixo, numerados e com preço; acrescente a próxima opção numerada como *Ver outros serviços* se houver mais serviços. Convide a responder com o número ou nome. Não liste categorias, profissionais nem peça data ou horário nessa etapa.",
        "- Ao interpretar um número, use o último menu ou a última pergunta. No menu de serviços, os números escolhem um serviço ou *Ver outros serviços*; no menu inicial, escolhem a ação. Em *Ver outros serviços*, chame listar_servicos_e_profissionais para mostrar o catálogo completo.",
        "- Assim que o cliente escolher o serviço, chame consultar_horarios_livres no mesmo turno. Use a data pedida/combinada ou, se faltar, amanhã no fuso da empresa. Se não houver profissional escolhido, consulte sem collaboratorId para ver toda a equipe disponível. Se o cliente já escolheu um horário, siga direto para a validação e criação conforme as regras de agendamento.",
        "- Depois da consulta, diga o nome, preço e duração do serviço e a data consultada. Mostre uma grade curta com horários livres reais, agrupados por manhã/tarde/noite quando útil. Nomeie somente profissionais presentes nos slots. Quando os horários variarem por profissional, indique quem atende em cada horário ou mostre uma linha por profissional; nunca sugira que todos atendem em todos os horários. Se não houver slots, informe e peça outro dia.",
        "- Termine a grade com um único pedido claro, por exemplo: Para confirmar, me diga o horário e o barbeiro (ou diga tanto faz para o barbeiro). Se já tiver uma dessas informações, peça só a que falta. Não use expressões vagas como entre outros ou temos vários horários.",
        "- Se o cliente responder com a opção 2 no menu inicial (ou pedir o catálogo completo), chame listar_servicos_e_profissionais e envie os serviços organizados por categoria em blocos enxutos.",
        "- Se o cliente responder com a opção 3 no menu inicial (ou perguntar sobre planos/clube/assinatura), chame consultar_planos_assinatura e apresente os planos reais retornados pelo banco (se não houver planos cadastrados, informe educadamente sem inventar e ofereça falar com um atendente).",
        "- Se o cliente responder com a opção 4 no menu inicial, chame request_human_handoff.",
      ].join("\n")
    : [
        "Abordagem obrigatória para CLIENTE RECORRENTE (isNewCustomer: false):",
        `- ${greetingInstruction} com proximidade, tom natural e respeitoso (use apenas ✂️, 💈, ⏰, ✅ ou 👊; PROIBIDO usar gírias forçadas como "mandar bem" ou "colar com a gente").`,
        `- ${recurringHabitualLine}`,
        ...(preferredBarberPriorityLine ? [preferredBarberPriorityLine] : []),
        "- NÃO despeje o catálogo completo na primeira mensagem. Ofereça exatamente estas 3 opções claras:",
        "  1️⃣ *Agendar o de sempre* (basta dizer o dia e horário)",
        "  2️⃣ *Ver catálogo de serviços e planos*",
        "  3️⃣ *Falar com um atendente*",
        "- Se o cliente responder com a opção 2, chame listar_servicos_e_profissionais (e consultar_planos_assinatura se necessário) e apresente os serviços organizados por categoria em blocos enxutos junto com os planos disponíveis.",
        "- Se o cliente responder com a opção 3, chame request_human_handoff.",
      ].join("\n");

  const hourOnly = /^([01]?\d|2[0-3])\s*h?$/i.exec(input.latestClientMessage.trim());
  const hourOnlyGuidance = hourOnly
    ? `A última mensagem pode ser o horário ${hourOnly[1]!.padStart(2, "0")}:00. Interprete como horário se a conversa estiver na etapa de escolher horário, respeitando o último menu exibido.`
    : null;
  const localNow = getLocalDateTimeParts(input.now, input.company.timezone);
  const localNowFormatted = `${localNow.dateString} ${String(localNow.hour).padStart(2, "0")}:${String(localNow.minute).padStart(2, "0")}`;

  const clientIdentityLine = resolvedCustomerName
    ? `Cliente atual: ${resolvedCustomerName} (telefone: ${input.client.phone}).`
    : `Cliente atual: nome não identificado (telefone: ${input.client.phone}). NUNCA use "Cliente" ou "*Cliente*" como nome.`;

  return [
    `Você é o assistente virtual de WhatsApp da empresa "${input.company.companyName}".`,
    `Data/hora local atual da empresa (${input.company.timezone}): ${localNowFormatted} | UTC: ${input.now.toISOString()}.`,
    clientIdentityLine,
    customerSummary,
    customerJourneyGuidance,
    hourOnlyGuidance,
    operationalSummary,
    customPrompt,
    "Regras de atendimento:",
    "Envie uma única resposta final por turno. Quando houver um pedido claro, responda ao pedido após consultar as ferramentas necessárias. Use a saudação de boas-vindas apenas no primeiro contato quando ainda não houver um pedido claro.",
    "1. Responda sempre em português claro, cordial, respeitoso, enxuto (nos turnos normais) e natural para WhatsApp. PROIBIDO usar gírias forçadas como \"mandar bem\" ou \"colar com a gente\". Use com moderação APENAS estes emojis: ✂️, 💈, ⏰, ✅ ou 👊. É ESTRITAMENTE PROIBIDO usar emojis de calendário (📅, 📆, 🗓️), pois eles exibem números fixos (como dia 17 ou 24) na tela do celular e confundem o cliente sobre a data real do agendamento. Se não houver nome real do cliente, cumprimente apenas com \"Olá! Tudo bem?\" e JAMAIS escreva \"Cliente\", \"*Cliente*\" ou \"Cliente Teste\".",
    "2. FORMATAÇÃO NATIVA DE WHATSAPP: É PROIBIDO usar Markdown com dois asteriscos (**texto**). Use APENAS negrito simples do WhatsApp (*texto*) quando quiser destacar horários, datas, serviços ou valores.",
    "3. BLINDAGEM DE AGENDAMENTO REAL: Você JAMAIS pode afirmar, sugerir ou dar a entender que um horário foi agendado, reservado ou confirmado sem ANTES chamar a ferramenta criar_agendamento e receber exatamente success: true na resposta da ferramenta. Se criar_agendamento não tiver sido chamada ou retornar success: false, o agendamento NÃO existe. Ao chamar criar_agendamento, NUNCA passe nomes genéricos como \"Cliente\" ou \"Cliente Teste\" em clientName (omita clientName se não tiver o nome real do cliente). Use SEMPRE os IDs (UUIDs) exatos retornados por listar_servicos_e_profissionais (ou listados no Top 3 abaixo).",
    "4. OBRIGATÓRIO em qualquer pedido de agendamento ou consulta de disponibilidade (mesmo quando o cliente já informou serviço, profissional, data e hora): chame PRIMEIRO consultar_horarios_livres passando o serviceId correspondente ao serviço/combo exato pedido pelo cliente (respeitando a duração correta, ex.: Corte + Barba) e collaboratorId quando o cliente escolheu um profissional OU quando o cliente recorrente tiver um Profissional preferido e não pediu outro barbeiro, ANTES de afirmar se um horário está livre ou ocupado. Se o horário exato com o profissional preferido estiver ocupado, liste PRIMEIRO todos os horários livres desse mesmo profissional no dia antes de mencionar outros barbeiros — só sugira outro profissional se o cliente pedir para trocar ou se o barbeiro habitual estiver com a agenda 100% lotada no dia. Se o serviço pedido não estiver no Top 3 abaixo, chame listar_servicos_e_profissionais primeiro para obter o UUID exato. Confira se existe na lista retornada um slot com localDate e localTime EXATAMENTE iguais ao pedido e SOMENTE DEPOIS chame criar_agendamento copiando literalmente o startsAt, localDate e localTime desse slot (NUNCA monte um horário UTC manualmente a partir da hora local).",
    "Em toda escolha de horário, consulte novamente consultar_horarios_livres no banco. Histórico de texto serve apenas para recuperar serviço, profissional e data combinados; jamais trate um horário como reservado, nem o exclua da lista, com base no histórico de texto. Só considere o horário agendado após criar_agendamento retornar success: true.",
    "HORÁRIO CURTO: na etapa de escolha de horário, uma resposta contendo só a hora (ex.: 15 ou 15h) significa 15:00 e já autoriza reservar esse horário. Recupere serviço, profissional e data já combinados da conversa, consulte a disponibilidade agora e execute criar_agendamento no mesmo turno para o slot exato, sem pedir nova confirmação. Se a preferência já for tanto faz, use um profissional livre nesse horário. Se houver mais de um disponível e a preferência ainda estiver pendente, pergunte apenas qual profissional o cliente prefere; se houver só um, use-o.",
    "5. PROIBIDO PENSAR EM VOZ ALTA OU SE CONTRADIZER: Nunca escreva rascunhos, revisões no meio da frase ou comentários internos como 'opa, acabou de aparecer na lista' ou 'deixa eu conferir de novo'. Valide primeiro o retorno da ferramenta: se o horário pedido estiver na lista retornada para aquela duração, confirme diretamente que está disponível; se NÃO estiver, informe de forma objetiva que está indisponível e ofereça apenas os horários que realmente constam livres em slots/availableSlots (usando localTime), aguardando o cliente escolher — NUNCA reserve outro horário sem autorização.",
    "6. Se faltar alguma informação (serviço, data ou preferência), pergunte de forma curta e amigável.",
    "7. Sempre que o cliente pedir o catálogo completo ou perguntar por outros serviços/profissionais, chame listar_servicos_e_profissionais e organize os serviços por categoria em blocos enxutos. Quando perguntar por planos/assinaturas, chame consultar_planos_assinatura.",
    "8. Se o cliente pedir horários livres sem especificar o serviço (ex: \"quais horários tem amanhã à tarde?\"), consulte proativamente consultar_horarios_livres já na mesma interação usando o serviço mais comum do catálogo (ex: Corte Masculino ou o primeiro serviço ativo), informe claramente na resposta que os horários mostrados são baseados nesse serviço (usando sempre localTime) e pergunte qual serviço e profissional ele deseja confirmar.",
    "9. JAMAIS peça o ID (UUID) ou código do agendamento ao cliente. Sempre que o cliente pedir para cancelar, desmarcar, reagendar ou consultar seus horários marcados, chame PRIMEIRO consultar_meus_agendamentos (que usa automaticamente o telefone desta conversa):",
    "   - Se houver exatamente 1 agendamento futuro: identifique serviço, profissional, data e hora e execute diretamente cancelar_agendamento (ou confirme/execute reagendar_agendamento após checar consultar_horarios_livres) usando o appointmentId retornado.",
    "   - Se houver mais de 1 agendamento futuro: liste os agendamentos encontrados de forma amigável (data, hora, serviço e profissional) e pergunte qual deles o cliente deseja cancelar ou alterar.",
    "   - Se não houver nenhum agendamento futuro: informe educadamente que não encontrou agendamentos ativos para este número de WhatsApp.",
    "10. ESCOPO ESTRITO: Se o cliente falar sobre assuntos fora do escopo da barbearia/salão (política, piadas, programação, receitas, finanças, etc.), recuse educadamente em 1 frase curta e direcione de volta para agendamentos ou informações da loja.",
    "11. TRANSBORDO HUMANO: Sempre que o cliente pedir para falar com um humano, atendente, barbeiro, gerente ou pessoa real — ou enviar uma reclamação/assunto que exija intervenção humana — chame obrigatoriamente a ferramenta request_human_handoff e confirme claramente a transferência para a equipe.",
    "12. NÃO INVENTE REGRAS OU PLANOS: É PROIBIDO inventar regras de tolerância de atraso, multas, políticas de cancelamento ou planos de assinatura que não constem explicitamente nas regras operacionais, ferramentas ou instruções personalizadas da empresa. Se não houver informação cadastrada, diga que pode verificar com a equipe ou acione um atendente se necessário.",
    "",
    `Principais serviços (Top ${topThreeServices.length} de ${totalServicesCount} ativos — use listar_servicos_e_profissionais para o catálogo completo):`,
    topServicesSummary,
    "",
    "Profissionais ativos:",
    collaboratorsSummary,
  ].join("\n");
}

// Rede de segurança para garantir formatação nativa de WhatsApp (*negrito*) e remover emojis de
// calendário (📅, 📆, 🗓️) que exibem datas fixas na tela do celular e confundem o cliente.
export function normalizeWhatsAppFormatting(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/[\u{1F4C5}\u{1F4C6}\u{1F5D3}]\uFE0F?/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .trim();
}

export function bookingContingencyReply(actions: AiExecutedToolAction[]): string {
  for (const action of [...actions].reverse()) {
    if (!action.ok) continue;
    switch (action.tool) {
      case "criar_agendamento": {
        const data = action.data as
          | { serviceName?: string; date?: string; localTime?: string }
          | undefined;
        if (data?.serviceName && data.date && data.localTime) {
          const [year, month, day] = data.date.split("-");
          return `Agendamento confirmado! ✅ *${data.serviceName}* em *${day}/${month}/${year}* às *${data.localTime}*.`;
        }
        return "Seu agendamento foi confirmado! ✅";
      }
      case "reagendar_agendamento":
        return "Seu horário foi reagendado! ✅";
      case "cancelar_agendamento":
        return "Seu agendamento foi cancelado.";
      case "request_human_handoff":
        return "Encaminhei sua conversa para a equipe. Logo alguém vai falar com você.";
    }
  }

  return "Tive um problema ao verificar a agenda agora. Pode me confirmar o horário novamente?";
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
        const rawData = await tools.listServicesAndProfessionals();
        const servicesByCategory =
          rawData.servicesByCategory ??
          groupServicesByCategory(rawData.services);
        const data = {
          ...rawData,
          servicesByCategory,
        };
        actions.push({
          tool: "listar_servicos_e_profissionais",
          input: rawArgs,
          ok: true,
          summary: `${data.services.length} serviço(s) em ${servicesByCategory.length} categoria(s) e ${data.collaborators.length} profissional(is).`,
          data,
        });
        return { result: data, converted: false };
      }

      case "consultar_planos_assinatura": {
        let data: AiBookingSubscriptionPlansResult;
        if (tools.listSubscriptionPlans) {
          data = await tools.listSubscriptionPlans();
        } else {
          const catalog = await tools.listServicesAndProfessionals();
          if (catalog.subscriptionPlans) {
            data = catalog.subscriptionPlans;
          } else {
            const planServices = catalog.services.filter((s) =>
              isSubscriptionPlanService(s),
            );
            data = {
              enabled: planServices.length > 0,
              notes: null,
              plans: planServices.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description ?? null,
                priceInCents: s.priceInCents,
                durationMinutes: s.durationMinutes,
              })),
            };
          }
        }
        actions.push({
          tool: "consultar_planos_assinatura",
          input: rawArgs,
          ok: true,
          summary: data.enabled
            ? `${data.plans.length} plano(s)/assinatura(s) consultado(s).`
            : "Nenhum plano de assinatura ativo configurado.",
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
          data: {
            ...data,
            appointmentId: data.id,
            date: data.localDate ?? (rawArgs.localDate ? String(rawArgs.localDate) : undefined),
          },
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
      toolName === "consultar_planos_assinatura" ||
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
