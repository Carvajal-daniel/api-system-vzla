export type ReminderTemplateId = "buttons" | "plain" | "whatsapp" | "external" | "custom";
export type ReminderLocale = "pt-BR" | "es";

export interface ReminderRenderContext {
  clientName: string;
  companyName: string;
  professionalName: string;
  serviceName: string;
  date: string;
  time: string;
  appUrl?: string;
}

export interface ReminderTemplateConfig {
  template: ReminderTemplateId;
  message?: string | null;
}

// Variáveis oficiais exibidas na configuração; {responsavel} e {cliente} seguem aceitos como aliases retrocompatíveis.
export const REMINDER_VARIABLES = [
  "nome",
  "empresa",
  "data",
  "hora",
  "profissional",
  "servico",
  "appURL",
] as const;

const STANDARD_TEMPLATES: Record<ReminderLocale, string> = {
  "pt-BR": [
    "Olá *{nome}*!",
    "",
    "Você tem um compromisso em *{empresa}*:",
    "",
    "Data: *{data}* às *{hora}*",
    "Profissional: *{profissional}*",
    "Serviço: *{servico}*",
  ].join("\n"),
  es: [
    "¡Hola *{nome}*!",
    "",
    "Tienes una cita en *{empresa}*:",
    "",
    "Fecha: *{data}* a las *{hora}*",
    "Profesional: *{profissional}*",
    "Servicio: *{servico}*",
  ].join("\n"),
};

export const DEFAULT_CUSTOM_REMINDER_MESSAGES: Record<ReminderLocale, string> = {
  "pt-BR": [
    STANDARD_TEMPLATES["pt-BR"],
    "",
    "Iremos te aguardar no dia e horário acima, caso tenha qualquer imprevisto por favor nos avise.",
    "",
    "Clique: {appURL}",
  ].join("\n"),
  es: [
    STANDARD_TEMPLATES.es,
    "",
    "Te esperamos en el día y horario indicados; ante cualquier imprevisto, por favor avísanos.",
    "",
    "Enlace: {appURL}",
  ].join("\n"),
};

export function getReminderTemplate(
  template: ReminderTemplateId,
  locale: ReminderLocale = "pt-BR",
  customMessage?: string | null,
): string {
  // Todos os 5 modelos incluem cliente, estabelecimento e profissional; no modo personalizado respeita o texto salvo pela empresa.
  if (template === "custom") {
    const trimmed = customMessage?.trim();
    return trimmed ? customMessage! : DEFAULT_CUSTOM_REMINDER_MESSAGES[locale];
  }
  return STANDARD_TEMPLATES[locale];
}

export function renderReminderMessage(
  config: ReminderTemplateConfig,
  context: ReminderRenderContext,
  locale: ReminderLocale = "pt-BR",
): string {
  const source = getReminderTemplate(config.template, locale, config.message);
  const replacements: Record<string, string> = {
    nome: context.clientName,
    cliente: context.clientName,
    empresa: context.companyName,
    data: context.date,
    hora: context.time,
    profissional: context.professionalName,
    responsavel: context.professionalName,
    servico: context.serviceName,
    appURL: context.appUrl ?? "",
  };

  return source.replace(/\{(\w+)\}/g, (token, key: string) => replacements[key] ?? token);
}
