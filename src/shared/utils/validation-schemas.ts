
import { z } from "zod";
import { isValidIanaTimeZone } from "../../modules/appointments/domain/services/timezone-utils.js";

export const nameSchema = z.string().trim().min(2, "Nombre inválido. Debe contener al menos 2 caracteres.").max(80);
export const companyNameSchema = z.string().trim().min(3, "Nome do estabelecimento inválido.").max(100);
export const phoneSchema = z.string().trim().min(10, "Telefone inválido.").max(20);
export const emailSchema = z.string().trim().toLowerCase().email("E-mail inválido.");
export const passwordSchema = z.string().min(6, "Senha muito curta.").max(15, "Senha muito longa.");
export const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Fuso horário inválido.")
  .max(64, "Fuso horário inválido.")
  .refine((value) => isValidIanaTimeZone(value), {
    message: "Invalid IANA timezone.",
  });


export const registerCompanySchema = z.object({
  companyName: companyNameSchema,
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema,
  password: passwordSchema,
  timezone: timezoneSchema.optional(),
});

export const updateCompanyTimezoneSchema = z.object({
  timezone: timezoneSchema,
});

export const registerCollaboratorSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  specialty: z.string().trim().min(1, "Especialidade obrigatória."),
  commissionPercentage: z.number().finite(),
});


export type RegisterCompanyInput = z.infer<typeof registerCompanySchema>;
