export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required.");
  }

  return secret;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
