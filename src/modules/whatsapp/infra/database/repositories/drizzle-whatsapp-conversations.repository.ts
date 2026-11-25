import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import {
  WhatsAppConversation,
  type WhatsAppAssignedMode,
  type WhatsAppConversationStatus,
} from "../../../domain/entities/whatsapp-conversation.entity.js";
import type {
  ListWhatsAppConversationsFilter,
  WhatsAppConversationListItem,
  WhatsAppConversationsRepository,
} from "../../../domain/repositories/whatsapp-conversations.repository.js";
import { WhatsAppConversationsTable } from "../schema/whatsapp-conversations-schema.js";
import { WhatsAppMessagesTable } from "../schema/whatsapp-messages-schema.js";

function mapRow(
  row: typeof WhatsAppConversationsTable.$inferSelect,
): WhatsAppConversation {
  return WhatsAppConversation.restore({
    id: row.id,
    companyId: row.companyId,
    clientId: row.clientId,
    phone: row.phone,
    contactName: row.contactName,
    status: row.status,
    assignedMode: row.assignedMode,
    unreadCount: row.unreadCount,
    lastMessageAt: row.lastMessageAt,
    aiPausedUntil: row.aiPausedUntil,
    lastAiSessionAt: row.lastAiSessionAt,
    hourlyMessageCount: row.hourlyMessageCount,
    hourlyWindowStartAt: row.hourlyWindowStartAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class DrizzleWhatsAppConversationsRepository
  implements WhatsAppConversationsRepository
{
  async findById(
    companyId: string,
    conversationId: string,
  ): Promise<WhatsAppConversation | null> {
    const [row] = await db
      .select()
      .from(WhatsAppConversationsTable)
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, companyId),
          eq(WhatsAppConversationsTable.id, conversationId),
        ),
      )
      .limit(1);

    return row ? mapRow(row) : null;
  }

  async findByCompanyAndPhone(
    companyId: string,
    normalizedPhone: string,
  ): Promise<WhatsAppConversation | null> {
    const [row] = await db
      .select()
      .from(WhatsAppConversationsTable)
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, companyId),
          eq(WhatsAppConversationsTable.phone, normalizedPhone),
        ),
      )
      .limit(1);

    return row ? mapRow(row) : null;
  }

  async upsertInbound(input: {
    companyId: string;
    phone: string;
    clientId: string | null;
    contactName: string | null;
    sentAt: Date;
    incrementUnread: boolean;
  }): Promise<WhatsAppConversation> {
    const now = new Date();
    const [row] = await db
      .insert(WhatsAppConversationsTable)
      .values({
        companyId: input.companyId,
        clientId: input.clientId,
        phone: input.phone,
        contactName: input.contactName,
        status: "OPEN",
        assignedMode: "AI_AUTOPILOT",
        unreadCount: input.incrementUnread ? 1 : 0,
        lastMessageAt: input.sentAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          WhatsAppConversationsTable.companyId,
          WhatsAppConversationsTable.phone,
        ],
        set: {
          clientId: sql`COALESCE(${WhatsAppConversationsTable.clientId}, ${input.clientId})`,
          contactName: input.contactName
            ? input.contactName
            : WhatsAppConversationsTable.contactName,
          status: sql`CASE WHEN ${WhatsAppConversationsTable.status} = 'ARCHIVED' THEN 'OPEN' ELSE ${WhatsAppConversationsTable.status} END`,
          unreadCount: input.incrementUnread
            ? sql`${WhatsAppConversationsTable.unreadCount} + 1`
            : WhatsAppConversationsTable.unreadCount,
          lastMessageAt: input.sentAt,
          updatedAt: now,
        },
      })
      .returning();

    return mapRow(row!);
  }

  async upsertOutbound(input: {
    companyId: string;
    phone: string;
    clientId: string | null;
    contactName: string | null;
    sentAt: Date;
    assignedMode?: WhatsAppAssignedMode | undefined;
    status?: WhatsAppConversationStatus | undefined;
  }): Promise<WhatsAppConversation> {
    const now = new Date();
    const [row] = await db
      .insert(WhatsAppConversationsTable)
      .values({
        companyId: input.companyId,
        clientId: input.clientId,
        phone: input.phone,
        contactName: input.contactName,
        status: input.status ?? "WAITING_CLIENT",
        assignedMode: input.assignedMode ?? "AI_AUTOPILOT",
        unreadCount: 0,
        lastMessageAt: input.sentAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          WhatsAppConversationsTable.companyId,
          WhatsAppConversationsTable.phone,
        ],
        set: {
          clientId: sql`COALESCE(${WhatsAppConversationsTable.clientId}, ${input.clientId})`,
          contactName: input.contactName
            ? input.contactName
            : WhatsAppConversationsTable.contactName,
          ...(input.assignedMode ? { assignedMode: input.assignedMode } : {}),
          ...(input.status ? { status: input.status } : {}),
          lastMessageAt: input.sentAt,
          updatedAt: now,
        },
      })
      .returning();

    return mapRow(row!);
  }

  async listByCompany(
    companyId: string,
    filter?: ListWhatsAppConversationsFilter,
  ): Promise<WhatsAppConversationListItem[]> {
    const conditions = [eq(WhatsAppConversationsTable.companyId, companyId)];

    if (filter?.assignedMode) {
      conditions.push(
        eq(WhatsAppConversationsTable.assignedMode, filter.assignedMode),
      );
    }

    const searchTerm = filter?.search?.trim();
    if (searchTerm) {
      const pattern = `%${searchTerm}%`;
      conditions.push(
        or(
          ilike(WhatsAppConversationsTable.contactName, pattern),
          ilike(WhatsAppConversationsTable.phone, pattern),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(WhatsAppConversationsTable)
      .where(and(...conditions))
      .orderBy(desc(WhatsAppConversationsTable.lastMessageAt))
      .limit(Math.min(Math.max(filter?.limit ?? 100, 1), 200));

    if (rows.length === 0) {
      return [];
    }

    const conversationIds = rows.map((row) => row.id);
    const recentMessages = await db
      .select({
        conversationId: WhatsAppMessagesTable.conversationId,
        content: WhatsAppMessagesTable.content,
        sentAt: WhatsAppMessagesTable.sentAt,
      })
      .from(WhatsAppMessagesTable)
      .where(
        and(
          eq(WhatsAppMessagesTable.companyId, companyId),
          inArray(WhatsAppMessagesTable.conversationId, conversationIds),
        ),
      )
      .orderBy(desc(WhatsAppMessagesTable.sentAt));

    const previewByConversation = new Map<string, string>();
    for (const msg of recentMessages) {
      if (!previewByConversation.has(msg.conversationId)) {
        previewByConversation.set(msg.conversationId, msg.content);
      }
    }

    return rows.map((row) => ({
      conversation: mapRow(row),
      lastMessagePreview: previewByConversation.get(row.id) ?? null,
    }));
  }

  async resetUnreadCount(
    companyId: string,
    conversationId: string,
  ): Promise<void> {
    await db
      .update(WhatsAppConversationsTable)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, companyId),
          eq(WhatsAppConversationsTable.id, conversationId),
        ),
      );
  }

  async updateAssignedMode(
    companyId: string,
    conversationId: string,
    assignedMode: WhatsAppAssignedMode,
  ): Promise<WhatsAppConversation | null> {
    const [row] = await db
      .update(WhatsAppConversationsTable)
      .set({ assignedMode, updatedAt: new Date() })
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, companyId),
          eq(WhatsAppConversationsTable.id, conversationId),
        ),
      )
      .returning();

    return row ? mapRow(row) : null;
  }

  async updateStatus(
    companyId: string,
    conversationId: string,
    status: WhatsAppConversationStatus,
  ): Promise<WhatsAppConversation | null> {
    const [row] = await db
      .update(WhatsAppConversationsTable)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, companyId),
          eq(WhatsAppConversationsTable.id, conversationId),
        ),
      )
      .returning();

    return row ? mapRow(row) : null;
  }

  async touchAfterOutbound(input: {
    companyId: string;
    conversationId: string;
    sentAt: Date;
    assignedMode?: WhatsAppAssignedMode | undefined;
    status?: WhatsAppConversationStatus | undefined;
  }): Promise<WhatsAppConversation | null> {
    const [row] = await db
      .update(WhatsAppConversationsTable)
      .set({
        lastMessageAt: input.sentAt,
        updatedAt: new Date(),
        ...(input.assignedMode ? { assignedMode: input.assignedMode } : {}),
        ...(input.status ? { status: input.status } : {}),
      })
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, input.companyId),
          eq(WhatsAppConversationsTable.id, input.conversationId),
        ),
      )
      .returning();

    return row ? mapRow(row) : null;
  }

  async updateAiPauseState(input: {
    companyId: string;
    conversationId: string;
    aiPausedUntil: Date | null;
    assignedMode?: WhatsAppAssignedMode | undefined;
  }): Promise<WhatsAppConversation | null> {
    const [row] = await db
      .update(WhatsAppConversationsTable)
      .set({
        aiPausedUntil: input.aiPausedUntil,
        ...(input.assignedMode ? { assignedMode: input.assignedMode } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, input.companyId),
          eq(WhatsAppConversationsTable.id, input.conversationId),
        ),
      )
      .returning();

    return row ? mapRow(row) : null;
  }

  async updateHourlyRateLimit(input: {
    companyId: string;
    conversationId: string;
    hourlyMessageCount: number;
    hourlyWindowStartAt: Date | null;
  }): Promise<WhatsAppConversation | null> {
    const [row] = await db
      .update(WhatsAppConversationsTable)
      .set({
        hourlyMessageCount: Math.max(0, Math.trunc(input.hourlyMessageCount)),
        hourlyWindowStartAt: input.hourlyWindowStartAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, input.companyId),
          eq(WhatsAppConversationsTable.id, input.conversationId),
        ),
      )
      .returning();

    return row ? mapRow(row) : null;
  }
}
