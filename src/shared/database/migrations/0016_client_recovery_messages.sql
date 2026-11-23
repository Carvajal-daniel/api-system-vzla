CREATE TABLE "client_recovery_messages" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "approval_id" uuid NOT NULL,
  "client_id" text NOT NULL,
  "approved_message" text NOT NULL,
  "approved_at" timestamptz NOT NULL DEFAULT now(),
  "message_id" text,
  "submitted_at" timestamptz,
  PRIMARY KEY ("company_id", "approval_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_recovery_pending_idx"
  ON "client_recovery_messages" ("company_id", "client_id")
  WHERE "message_id" IS NULL;
