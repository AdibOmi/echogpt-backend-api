-- Partial unique indexes: Prisma's schema language can't express these, so they
-- live in raw SQL. They make the database itself enforce business invariants,
-- which holds even under concurrent requests (unlike an app-level "check then insert").

-- A user can have at most ONE active subscription.
CREATE UNIQUE INDEX "subscriptions_one_active_per_user"
  ON "subscriptions" ("user_id")
  WHERE "status" = 'ACTIVE';

-- At most ONE AI provider can be the default.
CREATE UNIQUE INDEX "ai_providers_single_default"
  ON "ai_providers" ("is_default")
  WHERE "is_default" = true;
