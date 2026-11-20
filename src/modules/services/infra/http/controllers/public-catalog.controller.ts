import type { FastifyReply, FastifyRequest } from "fastify";
import type { ListPublicCompanyCatalogUseCase } from "../../../application/use-cases/list-public-company-catalog.use-case.js";
import { publicCompanyIdParamSchema } from "../schemas/service-http.schemas.js";

export class PublicCatalogController {
  constructor(
    private readonly listPublicCompanyCatalogUseCase: ListPublicCompanyCatalogUseCase,
  ) {}

  async listByCompany(request: FastifyRequest, reply: FastifyReply) {
    const { companyId } = publicCompanyIdParamSchema.parse(request.params);
    const catalog = await this.listPublicCompanyCatalogUseCase.execute(companyId);

    return reply.status(200).send(catalog);
  }
}
