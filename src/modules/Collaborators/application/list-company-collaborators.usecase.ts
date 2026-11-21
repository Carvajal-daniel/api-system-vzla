import type {
  CollaboratorMetricSummary,
  CollaboratorRecord,
  CollaboratorsRepository,
  TeamKpisSummary,
} from "../domain/repository/collaborators.repository.interface.js";

export interface CollaboratorOutputDTO {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly specialty: string;
  readonly commissionPercentage: number;
  readonly isActive: boolean;
  readonly role: "COLLABORATOR";
  readonly avatarUrl?: string | null | undefined;
}

export interface ListCollaboratorsResponse {
  teamKpis: TeamKpisSummary;
  collaborators: CollaboratorMetricSummary[];
}

export class ListCompanyCollaboratorsUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(
    companyId: string,
    filters?: { serviceId?: string | undefined; status?: "ACTIVE" | "INACTIVE" | undefined },
  ): Promise<CollaboratorRecord[]> {
    return this.collaboratorsRepository.findAllByCompanyId(companyId, filters);
  }

  async executeWithMetrics(
    companyId: string,
    referenceDate?: Date,
  ): Promise<ListCollaboratorsResponse> {
    return this.collaboratorsRepository.listCollaboratorsWithMetrics(companyId, referenceDate);
  }
}
