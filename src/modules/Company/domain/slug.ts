// Slugs reservados para rotas estáticas existentes sob /public/* e rotas de sistema.
export const RESERVED_COMPANY_SLUGS = new Set([
  "companies",
  "reviews",
  "health",
  "docs",
  "api",
  "admin",
  "public",
  "webhooks",
  "auth",
]);

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidCompanySlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return (
    normalized.length >= 2 &&
    normalized.length <= 100 &&
    SLUG_REGEX.test(normalized) &&
    !RESERVED_COMPANY_SLUGS.has(normalized)
  );
}

// Normaliza um slug customizado informado pelo dono sem mascarar palavras reservadas.
export function normalizeCustomCompanySlug(rawSlug: string): string {
  return rawSlug
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

// Normaliza o nome da empresa para um slug limpo, URL-safe e determinístico.
export function slugifyCompanyName(companyName: string, fallbackId?: string): string {
  const base = normalizeCustomCompanySlug(companyName).slice(0, 80);

  const safeBase = base.length >= 2 ? base : `barbearia-${(fallbackId ?? "000000").slice(0, 6)}`;
  if (RESERVED_COMPANY_SLUGS.has(safeBase)) {
    return `${safeBase}-shop`;
  }
  return safeBase;
}
