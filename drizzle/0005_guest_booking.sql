CREATE TABLE "slotly"."guest_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"organizer_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"guest_name" varchar(100) NOT NULL,
	"guest_email" varchar(254) NOT NULL,
	"guest_timezone" varchar(64) NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"quote" jsonb NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"sealed_code" varchar(256) NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"booking_id" uuid,
	CONSTRAINT "guest_challenges_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "guest_challenges_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "guest_challenges_hashes" CHECK ("slotly"."guest_challenges"."code_hash" ~ '^[a-f0-9]{64}$' and "slotly"."guest_challenges"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "guest_challenges_attempts" CHECK ("slotly"."guest_challenges"."attempts" between 0 and 5),
	CONSTRAINT "guest_challenges_bounds" CHECK (isfinite("slotly"."guest_challenges"."start_at") and isfinite("slotly"."guest_challenges"."end_at") and "slotly"."guest_challenges"."start_at" < "slotly"."guest_challenges"."end_at"),
	CONSTRAINT "guest_challenges_expiration" CHECK (isfinite("slotly"."guest_challenges"."expires_at") and "slotly"."guest_challenges"."expires_at" > "slotly"."guest_challenges"."created_at" and "slotly"."guest_challenges"."expires_at" <= "slotly"."guest_challenges"."created_at" + interval '10 minutes'),
	CONSTRAINT "guest_challenges_contact" CHECK (length(trim("slotly"."guest_challenges"."guest_name")) between 1 and 100 and "slotly"."guest_challenges"."guest_email" = lower(trim("slotly"."guest_challenges"."guest_email")) and position('@' in "slotly"."guest_challenges"."guest_email") > 1 and slotly.is_known_timezone("slotly"."guest_challenges"."guest_timezone")),
	CONSTRAINT "guest_challenges_quote" CHECK (jsonb_typeof("slotly"."guest_challenges"."quote") = 'object'),
	CONSTRAINT "guest_challenges_consumption" CHECK (("slotly"."guest_challenges"."consumed_at" is null) = ("slotly"."guest_challenges"."booking_id" is null) and ("slotly"."guest_challenges"."consumed_at" is null or (isfinite("slotly"."guest_challenges"."consumed_at") and "slotly"."guest_challenges"."invalidated_at" is null)))
);
--> statement-breakpoint
CREATE TABLE "slotly"."guest_rate_limits" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guest_rate_limits_count" CHECK ("slotly"."guest_rate_limits"."count" > 0)
);
--> statement-breakpoint
ALTER TABLE "slotly"."guest_challenges" ADD CONSTRAINT "guest_challenges_page_owner" FOREIGN KEY ("page_id","organizer_id") REFERENCES "slotly"."booking_pages"("id","organizer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."guest_challenges" ADD CONSTRAINT "guest_challenges_booking_owner" FOREIGN KEY ("booking_id","organizer_id") REFERENCES "slotly"."bookings"("id","organizer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_challenges_expiry" ON "slotly"."guest_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "guest_rate_limits_expiry" ON "slotly"."guest_rate_limits" USING btree ("expires_at");