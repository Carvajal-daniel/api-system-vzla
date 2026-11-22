import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../../../../shared/database/database.js";
import { getJwtSecret, isProduction } from "../../../../../shared/config/env.js";
import { BcryptPasswordHasher } from "../../../../../shared/cryptography/bcrypt-password-hasher.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { PasswordResetChallenge, PasswordResetRateLimit } from "../../database/schema/password-recovery-schema.js";
import { updatePasswordBodySchema } from "../schemas/auth-http.schemas.js";

const lifetimeMs = 15 * 60_000;
const maxAttempts = 5;
const identity = {
  email: z.email().max(254).optional(),
  phone: z.string().trim().min(8).max(30).regex(/^\+?[\d\s().-]+$/).optional(),
};
const hasOneContact = (value: { email?: string | undefined; phone?: string | undefined }) => Boolean(value.email) !== Boolean(value.phone);
const requestBody = z.object(identity).refine(hasOneContact, "Informe somente e-mail ou telefone.");
const resetBody = z.object({
  ...identity, code: z.string().regex(/^\d{6}$/), newPassword: updatePasswordBodySchema.shape.newPassword,
}).refine(hasOneContact, "Informe somente e-mail ou telefone.");

type Contact = { channel: "email" | "phone"; value: string };
export type PasswordResetDelivery = (data: { channel: Contact["channel"]; destination: string; code: string; expiresInMinutes: number }) => Promise<void>;

function contactFrom(input: z.infer<typeof requestBody>): Contact {
  if (input.email) return { channel: "email", value: input.email.toLowerCase() };
  const digits = input.phone!.replace(/\D/g, "");
  return { channel: "phone", value: digits };
}

function digest(...parts: string[]) {
  return createHmac("sha256", getJwtSecret()).update(JSON.stringify(["cloudgo-password-reset", ...parts])).digest("hex");
}

async function allow(rateKey: string, limit: number, now: Date) {
  const table = PasswordResetRateLimit;
  const expiresAt = new Date(now.getTime() + lifetimeMs);
  const [row] = await db.insert(table).values({ key: rateKey, requests: 1, expiresAt })
    .onConflictDoUpdate({
      target: table.key,
      set: {
        requests: sql`case when ${table.expiresAt} <= ${now.toISOString()}::timestamptz then 1 else ${table.requests} + 1 end`,
        expiresAt: sql`case when ${table.expiresAt} <= ${now.toISOString()}::timestamptz then excluded.expires_at else ${table.expiresAt} end`,
      },
      setWhere: sql`(${table.requests} < ${limit} or ${table.expiresAt} <= ${now.toISOString()}::timestamptz)`,
    }).returning({ key: table.key });
  return Boolean(row);
}

async function findAccount(contact: Contact) {
  const match = (column: typeof CompanyTable.email | typeof CompanyTable.phone | typeof CollaboratorTable.email | typeof CollaboratorTable.phone) =>
    contact.channel === "email"
      ? sql`lower(${column}) = ${contact.value}`
      : sql`regexp_replace(${column}, '[^0-9]', '', 'g') = ${contact.value}`;
  const [owners, collaborators] = await Promise.all([
    db.select({ id: CompanyTable.id }).from(CompanyTable)
      .where(and(eq(CompanyTable.isActive, true), match(contact.channel === "email" ? CompanyTable.email : CompanyTable.phone))).limit(2),
    db.select({ id: CollaboratorTable.id }).from(CollaboratorTable)
      .innerJoin(CompanyTable, eq(CompanyTable.id, CollaboratorTable.companyId))
      .where(and(eq(CollaboratorTable.isActive, true), eq(CompanyTable.isActive, true),
        match(contact.channel === "email" ? CollaboratorTable.email : CollaboratorTable.phone))).limit(2),
  ]);
  if (owners.length + collaborators.length !== 1) return null;
  return owners[0] ? { role: "OWNER", id: owners[0].id } : { role: "COLLABORATOR", id: collaborators[0]!.id };
}

export function registerPasswordRecovery(app: FastifyInstance, deliver?: PasswordResetDelivery) {
  const hasher = new BcryptPasswordHasher();

  app.post("/auth/forgot-password", async (request, reply) => {
    const contact = contactFrom(requestBody.parse(request.body));
    if (!deliver && isProduction()) return reply.code(503).send({ message: "O envio de códigos ainda não está configurado." });
    const now = new Date();
    const key = digest(contact.channel, contact.value);
    const genericResponse = { message: "Se os dados estiverem cadastrados, o código poderá ser enviado." };
    if (!await allow(digest("request-ip", request.ip), 15, now)) return reply.code(429).send({ message: "Tente novamente mais tarde." });
    if (randomInt(20) === 0) {
      await Promise.all([db.delete(PasswordResetRateLimit).where(lt(PasswordResetRateLimit.expiresAt, now)),
        db.delete(PasswordResetChallenge).where(lt(PasswordResetChallenge.expiresAt, now))]);
    }
    if (!await allow(digest("request-contact", key), 3, now)) return reply.code(202).send(genericResponse);
    const account = await findAccount(contact);
    if (!account) return reply.code(202).send(genericResponse);
    const code = String(randomInt(1_000_000)).padStart(6, "0");
    const values = { key, accountId: account.id, role: account.role, digest: digest(key, code), attempts: 0,
      issuedAt: now, expiresAt: new Date(now.getTime() + lifetimeMs) };
    const [challenge] = await db.insert(PasswordResetChallenge).values(values).onConflictDoUpdate({
      target: PasswordResetChallenge.key,
      set: values,
      setWhere: lt(PasswordResetChallenge.issuedAt, new Date(now.getTime() - 60_000)),
    }).returning({ key: PasswordResetChallenge.key });
    if (challenge) {
      if (deliver) {
        try {
          await deliver({ channel: contact.channel, destination: contact.value, code, expiresInMinutes: 15 });
        } catch {
          request.log.error("Password reset delivery failed");
        }
      } else {
        request.log.info({ recoveryCode: code, expiresInMinutes: 15 }, "Password reset code for local testing");
      }
    }
    return reply.code(202).send(genericResponse);
  });

  app.post("/auth/reset-password", async (request, reply) => {
    const body = resetBody.parse(request.body);
    const contact = contactFrom(body);
    const key = digest(contact.channel, contact.value);
    const now = new Date();
    if (!await allow(digest("verify-ip", request.ip), 30, now)) return reply.code(429).send({ message: "Tente novamente mais tarde." });
    const account = await findAccount(contact);
    const match = and(eq(PasswordResetChallenge.key, key), gt(PasswordResetChallenge.expiresAt, now));
    const invalid = { message: "Código inválido ou expirado." };
    if (!account) return reply.code(400).send(invalid);
    const changed = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${account.id}))`);
      const [challenge] = await tx.select().from(PasswordResetChallenge).where(match).for("update");
      if (!challenge || challenge.accountId !== account.id || challenge.role !== account.role || challenge.attempts >= maxAttempts) return false;
      if (!timingSafeEqual(Buffer.from(challenge.digest, "hex"), Buffer.from(digest(key, body.code), "hex"))) {
        await tx.update(PasswordResetChallenge).set({ attempts: challenge.attempts + 1 }).where(match);
        return false;
      }
      const password = await hasher.hash(body.newPassword);
      if (account.role === "OWNER") {
        await tx.update(CompanyTable).set({ password, updatedAt: now }).where(eq(CompanyTable.id, account.id));
      } else {
        await tx.update(CollaboratorTable).set({ password, updatedAt: now }).where(eq(CollaboratorTable.id, account.id));
      }
      await tx.delete(PasswordResetChallenge).where(and(eq(PasswordResetChallenge.accountId, account.id), eq(PasswordResetChallenge.role, account.role)));
      return true;
    });
    if (!changed) return reply.code(400).send(invalid);
    return reply.code(204).send();
  });
}
