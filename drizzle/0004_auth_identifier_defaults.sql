ALTER TABLE "slotly"."auth_accounts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "slotly"."auth_rate_limits" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "slotly"."auth_sessions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "slotly"."auth_users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "slotly"."auth_verifications" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;