import type {
  CloseMonthAwardResult,
  CollaboratorsRepository,
} from "../domain/repository/collaborators.repository.interface.js";

/**
 * Caso de uso para fechar oficialmente um mês de referência (YYYY-MM),
 * apurar o #1 do ranking conforme os pesos configurados da empresa e registrar o troféu.
 */
export class CloseMonthAwardUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(companyId: string, referenceMonth: string): Promise<CloseMonthAwardResult> {
    if (!this.collaboratorsRepository.closeMonthAward) {
      throw new Error("CloseMonthAward operation is not supported by repository.");
    }

    return this.collaboratorsRepository.closeMonthAward(companyId, referenceMonth);
  }
}
