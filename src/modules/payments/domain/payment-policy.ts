
import { DomainError } from "../../../shared/Errors/domain-error.js";

export class PaymentError extends DomainError {}

export function paymentConflict(code: string, message: string) {
  return new PaymentError(message, "CONFLICT", code);
}

export function missingPaymentResource(code: string) {
  return new PaymentError("Registro não encontrado.", "NOT_FOUND", code);
}

export function nextMonthlyDate(day: string) {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(date, lastDay));
  return next.toISOString().slice(0, 10);
}

export function coverageDayAllowed(day: string, days: number[] | null) {
  return days === null || days.includes(new Date(day + "T00:00:00Z").getUTCDay());
}
