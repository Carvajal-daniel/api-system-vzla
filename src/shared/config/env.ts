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
