import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { WhatsAppMessage } from "../../../domain/entities/whatsapp-message.entity.js";
import type { WhatsAppMessagesRepository } from "../../../domain/repositories/whatsapp-messages.repository.js";
import { WhatsAppMessagesTable } from "../schema/whatsapp-messages-schema.js";

function mapRow(row: typeof WhatsAppMessagesTable.$inferSelect): WhatsAppMessage {
  return WhatsAppMessage.restore({
    id: row.id,
    companyId: row.companyId,
    conversationId: row.conversationId,
    externalMessageId: row.externalMessageId,
    direction: row.direction,
    senderType: row.senderType,
    content: row.content,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    sentAt: row.sentAt,
  });
}

export class DrizzleWhatsAppMessagesRepository
  implements WhatsAppMessagesRepository
{
  async findByExternalMessageId(
    companyId: string,
    externalMessageId: string,
  ): Promise<WhatsAppMessage | null> {
    const [row] = await db
      .select()
      .from(WhatsAppMessagesTable)
      .where(
        and(
          eq(WhatsAppMessagesTable.companyId, companyId),
          eq(WhatsAppMessagesTable.externalMessageId, externalMessageId),
        ),
      )
      .limit(1);

    return row ? mapRow(row) : null;
  }

  async createIdempotent(
    message: WhatsAppMessage,
  ): Promise<{ message: WhatsAppMessage; created: boolean }> {
    const data = message.toPersistence();

    if (data.externalMessageId) {
      const existing = await this.findByExternalMessageId(
        data.companyId,
        data.externalMessageId,
      );
      if (existing) {
        return { message: existing, created: false };
      }

      try {
        const [inserted] = await db
          .insert(WhatsAppMessagesTable)
          .values(data)
          .returning();
        return { message: mapRow(inserted!), created: true };
      } catch (error) {
        const pgCode = (error as { code?: string; cause?: { code?: string } })
          ?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
        // Em condição de corrida entre dois webhooks simultâneos, retorna a mensagem já gravada.
        if (pgCode === "23505") {
          const raced = await this.findByExternalMessageId(
            data.companyId,
            data.externalMessageId,
          );
          if (raced) {
            return { message: raced, created: false };
          }
        }
        throw error;
      }
    }

    const [inserted] = await db
      .insert(WhatsAppMessagesTable)
      .values(data)
      .returning();

    return { message: mapRow(inserted!), created: true };
  }

  async listByConversation(
    companyId: string,
    conversationId: string,
    limit = 200,
  ): Promise<WhatsAppMessage[]> {
    const rows = await db
      .select()
      .from(WhatsAppMessagesTable)
      .where(
        and(
          eq(WhatsAppMessagesTable.companyId, companyId),
          eq(WhatsAppMessagesTable.conversationId, conversationId),
        ),
      )
      .orderBy(asc(WhatsAppMessagesTable.sentAt))
      .limit(Math.min(Math.max(limit, 1), 500));

    return rows.map(mapRow);
  }

  async listRecentByConversation(
    companyId: string,
    conversationId: string,
    limit = 16,
  ): Promise<WhatsAppMessage[]> {
    const rows = await db
      .select()
      .from(WhatsAppMessagesTable)
      .where(
        and(
          eq(WhatsAppMessagesTable.companyId, companyId),
          eq(WhatsAppMessagesTable.conversationId, conversationId),
        ),
      )
      .orderBy(desc(WhatsAppMessagesTable.sentAt))
      .limit(Math.min(Math.max(limit, 1), 50));

    return rows.reverse().map(mapRow);
  }
}
