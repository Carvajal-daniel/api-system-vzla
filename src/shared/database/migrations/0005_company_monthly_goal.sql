ALTER TABLE companies ADD COLUMN IF NOT EXISTS monthly_goal_in_cents integer NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS monthly_goal_currency varchar(3) NOT NULL DEFAULT 'BRL';
