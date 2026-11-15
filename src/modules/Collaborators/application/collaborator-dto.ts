export interface RegisterCollaboratorInputDTO {
  name: string;
  email: string;
  password: string;
  phone: string;
  companyId: string;
  specialty: string;
  commissionPercentage: number;
}

export interface RegisterCollaboratorOutputDTO {
  id: string;
  name: string;
  email: string;
  companyId: string;
  specialty: string;
  commissionPercentage: number;
  isActive: boolean;
}
