export interface RegisterCompanyInputDTO {
  companyName: string;
  name: string;
  phone: string;
  email: string;
  password: string;
  timezone?: string | undefined;
}

export interface RegisterCompanyOutputDTO {
  id: string;
  companyName: string;
  email: string;
  timezone: string;
}