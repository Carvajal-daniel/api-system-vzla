import { boolean, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export const CollaboratorTable = pgTable("collaborators", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  phone: text("phone").notNull(),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id),
  specialty: text("specialty").notNull(),
  commissionPercentage: numeric("commission_percentage", { mode: "number" }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});
