import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../../../shared/database/database.js";
import { authenticate, authorizeRoles } from "../../../../shared/http/auth/authenticate.js";
import { RecoveryMessageTable } from "../database/schema/recovery-messages-schema.js";
import { inactiveClients, recoveryCompany } from "./inactive-clients.js";
import {
  analyzeRecoveryReasons,
  buildHeuristicReasons,
  generateRecoveryMessage,
  whatsappProvider,
} from "./recovery-providers.js";

const owner = {
  preHandler: [authenticate, authorizeRoles("OWNER")],
  schema: {
    tags: ["Client Recovery (Owner)"],
    security: [{ bearerAuth: [] }],
  },
};
const clientIdSchema = z.string().trim().min(1).max(240);
const analyzeSchema = z.object({
  clientId: clientIdSchema,
});
const generateSchema = z.object({
  clientId: clientIdSchema,
  campaignGoal: z.string().trim().min(1).max(200),
  customOffer: z.string().trim().max(1000).optional(),
});
const sendSchema = z.object({
  clientId: clientIdSchema,
  approvedMessage: z.string().trim().min(1).max(1200),
  approvalId: z.uuid().optional(),
});
const inactiveQuery = z.object({
  inactiveDays: z.enum(["30", "45", "60", "90"]).default("30").transform(Number),
});
const unavailable = { code: "RECOVERY_CLIENT_UNAVAILABLE", message: "Client is no longer eligible for recovery." };
const unknownSend = { code: "RECOVERY_SEND_UNKNOWN", message: "A prior submission has not been confirmed by the provider." };
const disconnected = { code: "WHATSAPP_DISCONNECTED", message: "WhatsApp connection required." };

export async function clientRecoveryRoutes(app: FastifyInstance) {
  app.get("/v1/clients/inactive", owner, async (request) => {
    const { inactiveDays } = inactiveQuery.parse(request.query);
    const { companyId } = request.actor!;
    const company = await recoveryCompany(companyId);
    return { clients: await inactiveClients(companyId, company.country, inactiveDays) };
  });

  app.post("/v1/clients/recovery/analyze-reasons", {
    ...owner,
    schema: {
      ...owner.schema,
      summary: "Analyze probable churn reasons for an inactive client using history and AI",
    },
  }, async (request, reply) => {
    const { clientId } = analyzeSchema.parse(request.body);
    const { companyId } = request.actor!;
    const company = await recoveryCompany(companyId);
    const [client] = await inactiveClients(companyId, company.country, 30, clientId);
    if (!client) return reply.code(404).send(unavailable);

    const analysis = await analyzeRecoveryReasons({
      locale: company.locale,
      company: company.name,
      client,
    });

    return {
      clientId: client.id,
      ...analysis,
    };
  });

  app.post("/v1/clients/recovery/generate-message", owner, async (request, reply) => {
    const { clientId, campaignGoal, customOffer } = generateSchema.parse(request.body);
    const { companyId } = request.actor!;
    const company = await recoveryCompany(companyId);
    const [client] = await inactiveClients(companyId, company.country, 30, clientId);
    if (!client) return reply.code(404).send(unavailable);

    const heuristic = buildHeuristicReasons(client, company.locale);

    try {
      const message = await generateRecoveryMessage({
        locale: company.locale,
        company: company.name,
        firstName: client.name.trim().split(/\s+/, 1)[0] ?? "",
        service: client.lastVisit.serviceName,
        lowRating: client.diagnosticTag === "LOW_RATING" || (client.lastReview !== null && client.lastReview.stars <= 3),
        lastReview: client.lastReview ? { stars: client.lastReview.stars, comment: client.lastReview.comment } : null,
        diagnosticReasons: heuristic.reasons,
        campaignGoal,
        customOffer,
      });
      if (message === null) return reply.code(503).send({ code: "RECOVERY_AI_UNCONFIGURED", message: "Recovery AI is not configured." });
      return { message };
    } catch {
      return reply.code(502).send({ code: "RECOVERY_AI_UNAVAILABLE", message: "Recovery AI provider unavailable." });
    }
  });

  app.get("/v1/clients/recovery/whatsapp-status", owner, async (request, reply) => {
    try {
      const provider = whatsappProvider(request.actor!.companyId);
      return { connected: provider ? await provider.connected() : false };
    } catch {
      return reply.code(502).send({ code: "WHATSAPP_STATUS_UNAVAILABLE", message: "WhatsApp connection state unavailable." });
    }
  });

  app.post("/v1/clients/recovery/send", owner, async (request, reply) => {
    const { clientId, approvedMessage, approvalId = randomUUID() } = sendSchema.parse(request.body);
    const { companyId } = request.actor!;
    const approval = and(eq(RecoveryMessageTable.companyId, companyId), eq(RecoveryMessageTable.approvalId, approvalId));
    const existingApproval = async () => {
      const [previous] = await db.select().from(RecoveryMessageTable).where(approval);
      if (!previous) return null;
      if (previous.clientId !== clientId || previous.approvedMessage !== approvedMessage) {
        return reply.code(409).send({ code: "RECOVERY_APPROVAL_CONFLICT", message: "This approval was used with a different message." });
      }
      return previous.messageId ? reply.send({ messageId: previous.messageId }) : reply.code(409).send(unknownSend);
    };
    const priorResponse = await existingApproval();
    if (priorResponse) return priorResponse;

    const company = await recoveryCompany(companyId);
    const [client] = await inactiveClients(companyId, company.country, 30, clientId);
    if (!client) return reply.code(404).send(unavailable);
    if (!/^\+[1-9]\d{7,14}$/.test(client.phone)) {
      return reply.code(422).send({ code: "RECOVERY_INVALID_PHONE", message: "Client has no valid WhatsApp number." });
    }

    let provider;
    try {
      provider = whatsappProvider(companyId);
      if (!provider || !await provider.connected()) return reply.code(503).send(disconnected);
    } catch {
      return reply.code(502).send({ code: "WHATSAPP_STATUS_UNAVAILABLE", message: "WhatsApp connection state unavailable." });
    }

    const [claimed] = await db.insert(RecoveryMessageTable).values({ companyId, approvalId, clientId, approvedMessage })
      .onConflictDoNothing().returning({ approvalId: RecoveryMessageTable.approvalId });
    if (!claimed) return await existingApproval() ?? reply.code(409).send(unknownSend);

    let messageId: string | null;
    try {
      messageId = await provider.send(client.phone.slice(1), approvedMessage);
      if (messageId) {
        await db.update(RecoveryMessageTable).set({ messageId, submittedAt: new Date() }).where(approval);
        return { messageId };
      }
    } catch {
      // Preserve the claim when submission might have succeeded. Retrying must not send again.
      return reply.code(502).send(unknownSend);
    }

    await db.delete(RecoveryMessageTable).where(approval);
    return reply.code(502).send({ code: "WHATSAPP_SEND_REJECTED", message: "WhatsApp rejected the message." });
  });
}
