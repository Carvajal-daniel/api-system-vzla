import type { CollaboratorStatus } from "../domain/entities/collaborator.entity.js";

export interface RegisterCollaboratorInputDTO {
  name: string;
  email: string;
  password: string;
  phone: string;
  whatsapp?: string | null | undefined;
  companyId: string;
  specialty: string;
  bio?: string | null | undefined;
  commissionPercentage?: number | undefined;
  defaultCommissionRate?: number | undefined;
  monthlyRevenueGoal?: number | null | undefined;
  avatarUrl?: string | null | undefined;
  hiredAt?: Date | string | undefined;
}

export interface RegisterCollaboratorOutputDTO {
  id: string;
  name: string;
  email: string;
  companyId: string;
  specialty: string;
  phone: string;
  whatsapp?: string | null | undefined;
  bio?: string | null | undefined;
  commissionPercentage: number;
  defaultCommissionRate: number;
  monthlyRevenueGoal?: number | null | undefined;
  status: CollaboratorStatus;
  isActive: boolean;
  avatarUrl?: string | null | undefined;
  hiredAt: Date;
}

export interface UpdateCollaboratorInputDTO {
  collaboratorId: string;
  companyId: string;
  name?: string | undefined;
  phone?: string | undefined;
  whatsapp?: string | null | undefined;
  specialty?: string | undefined;
  bio?: string | null | undefined;
  defaultCommissionRate?: number | undefined;
  commissionPercentage?: number | undefined;
  monthlyRevenueGoal?: number | null | undefined;
  avatarUrl?: string | null | undefined;
  hiredAt?: Date | string | undefined;
}
