import { describe, expect, it, vi } from "vitest";
import type { Client } from "../../clients/domain/entities/client.entity.js";
import type { ClientsRepository } from "../../clients/domain/repositories/clients.repository.js";
import type { AiBookingContextProviderPort } from "../application/ports/ai-booking-context-provider.port.js";
import {
  ProcessInboundWhatsAppMessageUseCase,
  type ConversationalDispatchPort,
} from "../application/use-cases/process-inbound-whatsapp-message.use-case.js";
import { SendOwnerWhatsAppMessageUseCase } from "../application/use-cases/send-owner-whatsapp-message.use-case.js";
import { CompanyWhatsAppConnection } from "../domain/entities/company-whatsapp-connection.entity.js";
import {
  WhatsAppConversation,
  type WhatsAppAssignedMode,
  type WhatsAppConversationStatus,
} from "../domain/entities/whatsapp-conversation.entity.js";
import type { WhatsAppMessage } from "../domain/entities/whatsapp-message.entity.js";
import type { CompanyWhatsAppConnectionRepository } from "../domain/repositories/company-whatsapp-connection.repository.js";
import type {
  ListWhatsAppConversationsFilter,
  WhatsAppConversationListItem,
  WhatsAppConversationsRepository,
} from "../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../domain/repositories/whatsapp-messages.repository.js";
import { SimulatedBookingAgentAdapter } from "../infra/ai/simulated-booking-agent.adapter.js";
import { dispatchAiBookingToolCall } from "../infra/ai/ai-booking-tool-definitions.js";
import type { AiExecutedToolAction } from "../application/ports/ai-booking-agent.port.js";
import { WhatsAppAbsenceNotificationAdapter } from "../infra/notifications/whatsapp-absence-notification.adapter.js";

class InMemoryClientsRepository implements ClientsRepository {
  public items: Client[] = [];
  async listByCompany(companyId: string) {
    return this.items.filter((c) => c.companyId === companyId);
  }
  async findById(companyId: string, id: string) {
    return this.items.find((c) => c.companyId === companyId && c.id === id) ?? null;
  }
  async findByPhone(companyId: string, phone: string) {
    return this.items.find((c) => c.companyId === companyId && c.phone === phone) ?? null;
  }
  async create(client: Client) {
    this.items.push(client);
    return client;
  }
  async update(client: Client) {
    this.items = this.items.map((c) => (c.id === client.id ? client : c));
    return client;
  }
}

class InMemoryConnectionsRepository implements CompanyWhatsAppConnectionRepository {
  public items = new Map<string, CompanyWhatsAppConnection>();
  async findByCompanyId(companyId: string) {
    return this.items.get(companyId) ?? null;
  }
  async findByEvolutionInstanceName(instanceName: string) {
    for (const item of this.items.values()) {
      if (item.evolutionInstanceName === instanceName) return item;
    }
    return null;
  }
  async upsert(connection: CompanyWhatsAppConnection) {
    this.items.set(connection.companyId, connection);
    return connection;
  }
}

class InMemoryConversationsRepository implements WhatsAppConversationsRepository {
  public items: WhatsAppConversation[] = [];
  async findById(companyId: string, id: string) {
    return this.items.find((c) => c.companyId === companyId && c.id === id) ?? null;
  }
  async findByCompanyAndPhone(companyId: string, phone: string) {
    return this.items.find((c) => c.companyId === companyId && c.phone === phone) ?? null;
  }
  async upsertInbound(input: {
    companyId: string;
    phone: string;
    clientId: string | null;
    contactName: string | null;
    sentAt: Date;
    incrementUnread: boolean;
  }) {
    const existing = await this.findByCompanyAndPhone(input.companyId, input.phone);
    if (!existing) {
      const created = WhatsAppConversation.create({
        companyId: input.companyId,
        phone: input.phone,
        clientId: input.clientId,
        contactName: input.contactName,
        unreadCount: input.incrementUnread ? 1 : 0,
        now: input.sentAt,
      });
      this.items.push(created);
      return created;
    }
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      clientId: existing.clientId ?? input.clientId,
      contactName: input.contactName ?? existing.contactName,
      unreadCount: existing.unreadCount + (input.incrementUnread ? 1 : 0),
      lastMessageAt: input.sentAt,
      updatedAt: new Date(),
    });
    this.items = this.items.map((c) => (c.id === updated.id ? updated : c));
    return updated;
  }
  async upsertOutbound(input: {
    companyId: string;
    phone: string;
    clientId: string | null;
    contactName: string | null;
    sentAt: Date;
    assignedMode?: WhatsAppAssignedMode;
    status?: WhatsAppConversationStatus;
  }) {
    const existing = await this.findByCompanyAndPhone(input.companyId, input.phone);
    if (!existing) {
      const created = WhatsAppConversation.create({
        companyId: input.companyId,
        phone: input.phone,
        clientId: input.clientId,
        contactName: input.contactName,
        assignedMode: input.assignedMode ?? "AI_AUTOPILOT",
        status: input.status ?? "WAITING_CLIENT",
        now: input.sentAt,
      });
      this.items.push(created);
      return created;
    }
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      assignedMode: input.assignedMode ?? existing.assignedMode,
      status: input.status ?? existing.status,
      lastMessageAt: input.sentAt,
      updatedAt: new Date(),
    });
    this.items = this.items.map((c) => (c.id === updated.id ? updated : c));
    return updated;
  }
  async listByCompany(
    companyId: string,
    filter?: ListWhatsAppConversationsFilter,
  ): Promise<WhatsAppConversationListItem[]> {
    return this.items
      .filter((c) => c.companyId === companyId)
      .filter((c) => !filter?.assignedMode || c.assignedMode === filter.assignedMode)
      .map((conversation) => ({ conversation, lastMessagePreview: null }));
  }
  async resetUnreadCount(companyId: string, id: string) {
    this.items = this.items.map((c) =>
      c.companyId === companyId && c.id === id
        ? WhatsAppConversation.restore({ ...c.toPersistence(), unreadCount: 0 })
        : c,
    );
  }
  async updateAssignedMode(
    companyId: string,
    id: string,
    assignedMode: WhatsAppAssignedMode,
  ) {
    const existing = await this.findById(companyId, id);
    if (!existing) return null;
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      assignedMode,
    });
    this.items = this.items.map((c) => (c.id === id ? updated : c));
    return updated;
  }
  async updateStatus(
    companyId: string,
    id: string,
    status: WhatsAppConversationStatus,
  ) {
    const existing = await this.findById(companyId, id);
    if (!existing) return null;
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      status,
    });
    this.items = this.items.map((c) => (c.id === id ? updated : c));
    return updated;
  }
  async touchAfterOutbound(input: {
    companyId: string;
    conversationId: string;
    sentAt: Date;
    assignedMode?: WhatsAppAssignedMode;
    status?: WhatsAppConversationStatus;
  }) {
    const existing = await this.findById(input.companyId, input.conversationId);
    if (!existing) return null;
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      assignedMode: input.assignedMode ?? existing.assignedMode,
      status: input.status ?? existing.status,
      lastMessageAt: input.sentAt,
    });
    this.items = this.items.map((c) => (c.id === updated.id ? updated : c));
    return updated;
  }
}

class InMemoryMessagesRepository implements WhatsAppMessagesRepository {
  public items: WhatsAppMessage[] = [];
  async findByExternalMessageId(companyId: string, externalId: string) {
    return (
      this.items.find(
        (m) => m.companyId === companyId && m.externalMessageId === externalId,
      ) ?? null
    );
  }
  async createIdempotent(message: WhatsAppMessage) {
    if (message.externalMessageId) {
      const existing = await this.findByExternalMessageId(
        message.companyId,
        message.externalMessageId,
      );
      if (existing) return { message: existing, created: false };
    }
    this.items.push(message);
    return { message, created: true };
  }
  async listByConversation(companyId: string, conversationId: string) {
    return this.items.filter(
      (m) => m.companyId === companyId && m.conversationId === conversationId,
    );
  }
  async listRecentByConversation(companyId: string, conversationId: string, limit = 16) {
    return this.items
      .filter((m) => m.companyId === companyId && m.conversationId === conversationId)
      .slice(-limit);
  }
}

describe("WhatsApp Block 2 — Inbound AI, Idempotency, Owner Takeover & Absence Notifications", () => {
  it("creates client, persists inbound/outbound messages, books via SimulatedBookingAgentAdapter and enforces webhook idempotency", async () => {
    const companyId = "11111111-1111-4111-8111-111111111111";
    const clientsRepo = new InMemoryClientsRepository();
    const connectionsRepo = new InMemoryConnectionsRepository();
    const conversationsRepo = new InMemoryConversationsRepository();
    const messagesRepo = new InMemoryMessagesRepository();

    await connectionsRepo.upsert(CompanyWhatsAppConnection.createDefault(companyId));

    const createAppointmentMock = vi.fn().mockResolvedValue({
      id: "appt-123",
      startsAt: "2026-11-25T13:00:00.000Z",
      endsAt: "2026-11-25T13:45:00.000Z",
      status: "CONFIRMED",
      serviceName: "Corte Degradê",
      collaboratorId: "collab-1",
    });

    const aiContextProvider: AiBookingContextProviderPort = {
      buildContextAndTools: async () => ({
        company: {
          companyId,
          companyName: "Barbearia Prime",
          timezone: "America/Sao_Paulo",
          aiSystemPrompt: null,
          services: [
            {
              id: "svc-1",
              name: "Corte Degradê",
              durationMinutes: 45,
              priceInCents: 5500,
            },
          ],
          collaborators: [
            {
              id: "collab-1",
              name: "Carlos",
              specialty: "Cortes",
              serviceIds: ["svc-1"],
            },
          ],
        },
        tools: {
          listServicesAndProfessionals: async () => ({
            services: [
              {
                id: "svc-1",
                name: "Corte Degradê",
                durationMinutes: 45,
                priceInCents: 5500,
              },
            ],
            collaborators: [
              {
                id: "collab-1",
                name: "Carlos",
                specialty: "Cortes",
                serviceIds: ["svc-1"],
              },
            ],
          }),
          checkAvailability: async () => ({
            date: "2026-11-25",
            timezone: "America/Sao_Paulo",
            serviceDurationMinutes: 45,
            slots: [
              {
                startsAt: "2026-11-25T13:00:00.000Z",
                endsAt: "2026-11-25T13:45:00.000Z",
                collaboratorId: "collab-1",
                collaboratorName: "Carlos",
              },
            ],
          }),
          listCustomerUpcomingAppointments: vi.fn().mockResolvedValue({ appointments: [] }),
          createAppointment: createAppointmentMock,
          rescheduleAppointment: vi.fn(),
          cancelAppointment: vi.fn(),
        },
      }),
    };

    let outboundSeq = 0;
    const gatewayRouter: ConversationalDispatchPort = {
      send: vi.fn().mockImplementation(async () => ({
        purpose: "CONVERSATIONAL_REPLY" as const,
        provider: "MOCK_READY" as const,
        referenceId: `out-msg-${++outboundSeq}`,
      })),
    };

    const useCase = new ProcessInboundWhatsAppMessageUseCase(
      clientsRepo,
      connectionsRepo,
      conversationsRepo,
      messagesRepo,
      new SimulatedBookingAgentAdapter(),
      aiContextProvider,
      gatewayRouter,
    );

    const first = await useCase.execute({
      companyId,
      phone: "+5511999998888",
      contactName: "Lucas Silva",
      content: "Quero agendar Corte Degradê amanhã às 10:00",
      externalMessageId: "wamid-001",
      source: "SIMULATOR",
      debounceMs: 0,
    });

    expect(first.duplicated).toBe(false);
    expect(clientsRepo.items).toHaveLength(1);
    expect(createAppointmentMock).toHaveBeenCalledTimes(1);
    expect(first.outboundMessage?.senderType).toBe("AI_AGENT");
    expect(first.conversation.status).toBe("CONVERTED");
    expect(gatewayRouter.send).toHaveBeenCalledTimes(1);

    // Reenvio do mesmo externalMessageId deve ser ignorado (idempotência)
    const duplicate = await useCase.execute({
      companyId,
      phone: "+5511999998888",
      contactName: "Lucas Silva",
      content: "Quero agendar Corte Degradê amanhã às 10:00",
      externalMessageId: "wamid-001",
      source: "WEBHOOK",
      debounceMs: 0,
    });

    expect(duplicate.duplicated).toBe(true);
    expect(createAppointmentMock).toHaveBeenCalledTimes(1);
    expect(gatewayRouter.send).toHaveBeenCalledTimes(1);

    // Envio manual pelo dono muda automaticamente a conversa para HUMAN
    const sendOwnerUseCase = new SendOwnerWhatsAppMessageUseCase(
      conversationsRepo,
      messagesRepo,
      gatewayRouter,
    );
    const manual = await sendOwnerUseCase.execute({
      companyId,
      conversationId: first.conversation.id,
      content: "Oi Lucas, te espero aqui!",
    });

    expect(manual.conversation.assignedMode).toBe("HUMAN");
    expect(manual.message.senderType).toBe("OWNER");
  });

  it("notifies affected clients via WhatsAppAbsenceNotificationAdapter and logs outbound messages", async () => {
    const companyId = "22222222-2222-4222-8222-222222222222";
    const clientsRepo = new InMemoryClientsRepository();
    const conversationsRepo = new InMemoryConversationsRepository();
    const messagesRepo = new InMemoryMessagesRepository();
    const gatewayRouter: ConversationalDispatchPort = {
      send: vi.fn().mockResolvedValue({
        purpose: "CONVERSATIONAL_REPLY",
        provider: "MOCK_READY",
        referenceId: "absence-msg-1",
      }),
    };

    const adapter = new WhatsAppAbsenceNotificationAdapter(
      gatewayRouter,
      conversationsRepo,
      messagesRepo,
      clientsRepo,
    );

    await adapter.notifyAffectedAppointments({
      companyId,
      blockId: "block-1",
      collaboratorId: "collab-1",
      startsAt: "2026-11-26T12:00:00.000Z",
      endsAt: "2026-11-26T18:00:00.000Z",
      reason: "Imprevisto médico",
      affectedAppointments: [
        {
          id: "appt-1",
          collaboratorId: "collab-1",
          serviceId: "svc-1",
          clientName: "João Pedro",
          clientPhone: "+5511988887777",
          startsAt: "2026-11-26T14:00:00.000Z",
          endsAt: "2026-11-26T14:45:00.000Z",
          status: "CONFIRMED",
        },
      ],
    });

    expect(gatewayRouter.send).toHaveBeenCalledTimes(1);
    expect(conversationsRepo.items).toHaveLength(1);
    expect(messagesRepo.items).toHaveLength(1);
    expect(messagesRepo.items[0]?.metadata.kind).toBe("ABSENCE_NOTIFICATION");
  });

  it("propagates createAppointment conflict response with availableSlots without marking conversation as converted", async () => {
    const actions: AiExecutedToolAction[] = [];
    const availableSlots = [
      {
        startsAt: "2026-11-25T16:00:00.000Z",
        endsAt: "2026-11-25T16:40:00.000Z",
        localDate: "2026-11-25",
        localTime: "13:00",
        collaboratorId: "collab-nicolas",
        collaboratorName: "Nicolas Ferreira",
      },
    ];

    const dispatched = await dispatchAiBookingToolCall(
      "criar_agendamento",
      {
        serviceId: "svc-corte",
        collaboratorId: "collab-nicolas",
        startsAt: "2026-11-25T12:00:00.000Z",
        localDate: "2026-11-25",
        localTime: "09:00",
      },
      {
        listServicesAndProfessionals: vi.fn(),
        checkAvailability: vi.fn(),
        listCustomerUpcomingAppointments: vi.fn().mockResolvedValue({ appointments: [] }),
        createAppointment: vi.fn().mockResolvedValue({
          success: false,
          error: "Horário já ocupado na agenda",
          availableSlots,
        }),
        rescheduleAppointment: vi.fn(),
        cancelAppointment: vi.fn(),
      },
      actions,
    );

    expect(dispatched.converted).toBe(false);
    expect(dispatched.result).toEqual({
      success: false,
      error: "Horário já ocupado na agenda",
      availableSlots,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.ok).toBe(false);
    expect(actions[0]?.summary).toBe("Horário já ocupado na agenda");
  });

  it("locates upcoming customer appointment via consultar_meus_agendamentos and cancels it without asking for UUID", async () => {
    const actions: AiExecutedToolAction[] = [];
    const upcoming = [
      {
        appointmentId: "appt-future-1",
        serviceName: "Corte Masculino",
        collaboratorName: "Nicolas Ferreira",
        localDate: "2026-11-25",
        localTime: "16:00",
        startsAt: "2026-11-25T19:00:00.000Z",
        status: "CONFIRMED",
      },
    ];

    const cancelMock = vi.fn().mockResolvedValue({
      id: "appt-future-1",
      status: "CANCELED",
    });
    const tools = {
      listServicesAndProfessionals: vi.fn().mockResolvedValue({ services: [], collaborators: [] }),
      checkAvailability: vi.fn(),
      listCustomerUpcomingAppointments: vi.fn().mockResolvedValue({ appointments: upcoming }),
      createAppointment: vi.fn(),
      rescheduleAppointment: vi.fn(),
      cancelAppointment: cancelMock,
    };

    const listed = await dispatchAiBookingToolCall(
      "consultar_meus_agendamentos",
      {},
      tools,
      actions,
    );
    expect(listed.converted).toBe(false);
    expect(listed.result).toEqual({ appointments: upcoming });

    const cancelled = await dispatchAiBookingToolCall(
      "cancelar_agendamento",
      { appointmentId: "appt-future-1", cancellationReason: "Imprevisto" },
      tools,
      actions,
    );
    expect(cancelled.result).toEqual({ id: "appt-future-1", status: "CANCELED" });
    expect(cancelMock).toHaveBeenCalledWith({
      appointmentId: "appt-future-1",
      cancellationReason: "Imprevisto",
    });

    // Também valida o fluxo completo no SimulatedBookingAgentAdapter (1 agendamento -> cancela direto sem pedir UUID)
    cancelMock.mockClear();
    const adapter = new SimulatedBookingAgentAdapter();
    const reply = await adapter.generateReply({
      company: {
        companyId: "11111111-1111-4111-8111-111111111111",
        companyName: "Tapa no Corte",
        timezone: "America/Sao_Paulo",
        aiSystemPrompt: null,
        services: [],
        collaborators: [],
      },
      client: { id: null, name: "Douglas", phone: "+5511999998888" },
      history: [],
      latestClientMessage: "Quero cancelar meu agendamento",
      now: new Date("2026-11-24T21:00:00.000Z"),
      tools,
    });

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(reply.replyText).toContain("Corte Masculino");
    expect(reply.replyText).toContain("Nicolas Ferreira");
    expect(reply.replyText).not.toContain("código do agendamento");
  });
});
