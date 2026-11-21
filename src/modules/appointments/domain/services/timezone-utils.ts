import {
  InvalidLocalDateError,
  InvalidTimeZoneError,
} from "../errors/appointment-errors.js";

// Fuso horário padrão usado apenas como fallback de migração/compatibilidade.
export const DEFAULT_COMPANY_TIMEZONE = "America/Caracas";

const LOCAL_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface LocalDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
  second: number;
  dateString: string;
  dayOfWeek: number; // 0 = Domingo .. 6 = Sábado
  minutesFromMidnight: number;
}

export function isValidIanaTimeZone(timezone: string): boolean {
  const trimmed = timezone.trim();
  if (!trimmed) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function assertValidIanaTimeZone(timezone: string): string {
  const trimmed = timezone.trim();
  if (!isValidIanaTimeZone(trimmed)) {
    throw new InvalidTimeZoneError(timezone);
  }
  return trimmed;
}

export function parseLocalDateString(dateStr: string): LocalDateParts {
  const match = LOCAL_DATE_REGEX.exec(dateStr);
  if (!match) {
    throw new InvalidLocalDateError();
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Valida datas reais do calendário (ex.: rejeita 2026-02-30).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new InvalidLocalDateError();
  }

  return { year, month, day };
}

export function parseLocalTimeString(timeStr: string): {
  hour: number;
  minute: number;
} {
  const match = LOCAL_TIME_REGEX.exec(timeStr);
  if (!match) {
    throw new Error(`Invalid HH:MM time string: "${timeStr}".`);
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function formatUtcPartsInTimeZone(
  utcDate: Date,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(utcDate);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const part of parts) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
    else if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
    else if (part.type === "second") second = Number(part.value);
  }

  // Em alguns motores ICU, meia-noite pode aparecer como 24; normalizamos para 00.
  if (hour === 24) {
    hour = 0;
  }

  return { year, month, day, hour, minute, second };
}

function computeOffsetMs(utcMs: number, timezone: string): number {
  const local = formatUtcPartsInTimeZone(new Date(utcMs), timezone);
  const asUtcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  // Descarta milissegundos residuais do instante de entrada para obter o deslocamento exato do fuso.
  const truncatedUtcMs = Math.floor(utcMs / 1000) * 1000;
  return asUtcMs - truncatedUtcMs;
}

/**
 * Converte data/hora local na zona IANA informada para o instante UTC exato.
 * Usa duas passagens de refinamento de offset para lidar corretamente com transições de horário de verão (DST).
 */
export function localDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const validTz = assertValidIanaTimeZone(timezone);
  const targetWallMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const firstOffset = computeOffsetMs(targetWallMs, validTz);
  const firstGuessUtcMs = targetWallMs - firstOffset;

  const refinedOffset = computeOffsetMs(firstGuessUtcMs, validTz);
  return new Date(targetWallMs - refinedOffset);
}

/**
 * Extrai data local, dia da semana local (0..6) e minutos desde a meia-noite local a partir de um instante UTC.
 * Garante que horários noturnos (ex.: 21:30 em America/Sao_Paulo ou America/Caracas) permaneçam no dia local correto
 * mesmo quando em UTC já pertencem ao dia seguinte.
 */
export function getLocalDateTimeParts(
  utcDate: Date,
  timezone: string,
): LocalDateTimeParts {
  const validTz = assertValidIanaTimeZone(timezone);
  const { year, month, day, hour, minute, second } = formatUtcPartsInTimeZone(
    utcDate,
    validTz,
  );

  const pad2 = (n: number): string => String(n).padStart(2, "0");
  const dateString = `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateString,
    dayOfWeek,
    minutesFromMidnight: hour * 60 + minute,
  };
}

/**
 * Retorna os limites UTC [startUtc, endUtc) que cobrem integralmente o dia calendário local informado.
 */
export function getLocalDayUtcBounds(
  dateStr: string,
  timezone: string,
): { startUtc: Date; endUtc: Date; dayOfWeek: number } {
  const validTz = assertValidIanaTimeZone(timezone);
  const { year, month, day } = parseLocalDateString(dateStr);

  const startUtc = localDateTimeToUtc(year, month, day, 0, 0, validTz);

  const nextDayProbe = new Date(Date.UTC(year, month - 1, day + 1));
  const endUtc = localDateTimeToUtc(
    nextDayProbe.getUTCFullYear(),
    nextDayProbe.getUTCMonth() + 1,
    nextDayProbe.getUTCDate(),
    0,
    0,
    validTz,
  );

  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return { startUtc, endUtc, dayOfWeek };
}
