ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "slug" varchar(120);
--> statement-breakpoint
WITH normalized AS (
  SELECT
    id,
    COALESCE(
      NULLIF(
        LEFT(
          TRIM(BOTH '-' FROM REGEXP_REPLACE(
            LOWER(
              TRANSLATE(
                company_name,
                'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
                'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
              )
            ),
            '[^a-z0-9]+',
            '-',
            'g'
          )),
          80
        ),
        ''
      ),
      'barbearia-' || LEFT(id::text, 6)
    ) AS raw_base
  FROM "companies"
),
safe_base AS (
  SELECT
    id,
    CASE
      WHEN LENGTH(raw_base) < 2 THEN 'barbearia-' || LEFT(id::text, 6)
      WHEN raw_base IN ('companies', 'reviews', 'health', 'docs', 'api', 'admin', 'public', 'webhooks', 'auth')
        THEN raw_base || '-shop'
      ELSE raw_base
    END AS base_slug
  FROM normalized
),
ranked AS (
  SELECT
    id,
    base_slug,
    ROW_NUMBER() OVER (PARTITION BY base_slug ORDER BY id) AS rn
  FROM safe_base
)
UPDATE "companies" AS c
SET "slug" = CASE
  WHEN r.rn = 1 THEN r.base_slug
  ELSE r.base_slug || '-' || LEFT(c.id::text, 6)
END
FROM ranked AS r
WHERE c.id = r.id
  AND (c."slug" IS NULL OR TRIM(c."slug") = '');
--> statement-breakpoint
ALTER TABLE "companies"
  ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_slug_unique"
  ON "companies" ("slug");
