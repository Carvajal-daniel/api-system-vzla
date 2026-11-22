export function getGoogleMapsApiKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() || undefined;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required.");
  }

  return secret;
}

export function getJwtExpiresIn(): string {
  // Permite configurar a validade do token por ambiente, mantendo 1 dia como padrão seguro.
  const expiresIn = process.env.JWT_EXPIRES_IN?.trim();
  return expiresIn || "1d";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getCorsOrigins(): string[] | false {
  // Permite múltiplas origens separadas por vírgula em CORS_ORIGIN; fora de produção usa localhost do Vite como padrão seguro.
  const raw = process.env.CORS_ORIGIN?.trim();

  if (raw) {
    const origins = raw
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);

    if (origins.length > 0) {
      return origins;
    }
  }

  return isProduction() ? false : ["http://localhost:5173"];
}
