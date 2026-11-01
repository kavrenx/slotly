CREATE TABLE "slotly"."mail_delivery_limits" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_delivery_limits_key" CHECK ("slotly"."mail_delivery_limits"."key" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mail_delivery_limits_count" CHECK ("slotly"."mail_delivery_limits"."count" between 1 and 1000000),
	CONSTRAINT "mail_delivery_limits_expiry_finite" CHECK (isfinite("slotly"."mail_delivery_limits"."expires_at"))
);
--> statement-breakpoint
CREATE INDEX "mail_delivery_limits_expiry" ON "slotly"."mail_delivery_limits" USING btree ("expires_at");