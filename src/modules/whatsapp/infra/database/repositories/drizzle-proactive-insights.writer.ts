import { db } from "../../../../../shared/database/database.js";
import { AiProactiveInsightsTable } from "../../../../billing/infra/database/schema/ai-proactive-insights-schema.js";
import type {
  CreateProactiveInsightInput,
  ProactiveInsightsWriterPort,
} from "../../../application/ports/proactive-insights-writer.port.js";

export class DrizzleProactiveInsightsWriter
  implements ProactiveInsightsWriterPort
{
  public async createInsight(
    input: CreateProactiveInsightInput,
  ): Promise<{ id: string }> {
    const [row] = await db
      .insert(AiProactiveInsightsTable)
      .values({
        tenantId: input.tenantId,
        module: input.module,
        type: input.type,
        title: input.title,
        description: input.description,
        impactLabel: input.impactLabel ?? null,
        actionPayload: input.actionPayload ?? null,
        status: "PENDING",
        expiresAt: input.expiresAt ?? null,
      })
      .returning({ id: AiProactiveInsightsTable.id });

    return { id: row!.id };
  }
}
