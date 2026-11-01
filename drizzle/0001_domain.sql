-- This helper must precede the table CHECK constraints that use it.
CREATE FUNCTION slotly.is_known_timezone(zone text) RETURNS boolean
LANGUAGE sql STABLE STRICT SET search_path = pg_catalog
AS $$ SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = zone) $$;
--> statement-breakpoint
CREATE TABLE "slotly"."date_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"mode" varchar(8) NOT NULL,
	CONSTRAINT "date_overrides_date" UNIQUE("schedule_id","local_date"),
	CONSTRAINT "date_overrides_id_mode" UNIQUE("id","mode"),
	CONSTRAINT "date_overrides_mode" CHECK ("slotly"."date_overrides"."mode" in ('closed', 'replace')),
	CONSTRAINT "date_overrides_finite" CHECK (isfinite("slotly"."date_overrides"."local_date"))
);
--> statement-breakpoint
CREATE TABLE "slotly"."organizers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"locale" varchar(8) DEFAULT 'ru' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizers_name" CHECK (length(trim("slotly"."organizers"."display_name")) between 1 and 100),
	CONSTRAINT "organizers_locale" CHECK ("slotly"."organizers"."locale" in ('ru', 'en'))
);
--> statement-breakpoint
CREATE TABLE "slotly"."override_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"override_id" uuid NOT NULL,
	"override_mode" varchar(8) DEFAULT 'replace' NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "override_windows_replace_only" CHECK ("slotly"."override_windows"."override_mode" = 'replace'),
	CONSTRAINT "override_windows_bounds" CHECK ("slotly"."override_windows"."start_minute" >= 0 and "slotly"."override_windows"."end_minute" <= 1440 and "slotly"."override_windows"."start_minute" < "slotly"."override_windows"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "slotly"."schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_one_per_organizer" UNIQUE("organizer_id"),
	CONSTRAINT "schedules_id_owner" UNIQUE("id","organizer_id"),
	CONSTRAINT "schedules_timezone" CHECK (slotly.is_known_timezone("slotly"."schedules"."timezone")),
	CONSTRAINT "schedules_version" CHECK ("slotly"."schedules"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "slotly"."weekly_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "weekly_windows_weekday" CHECK ("slotly"."weekly_windows"."weekday" between 1 and 7),
	CONSTRAINT "weekly_windows_bounds" CHECK ("slotly"."weekly_windows"."start_minute" >= 0 and "slotly"."weekly_windows"."end_minute" <= 1440 and "slotly"."weekly_windows"."start_minute" < "slotly"."weekly_windows"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "slotly"."booking_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" varchar(1000) DEFAULT '' NOT NULL,
	"state" varchar(12) DEFAULT 'draft' NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"step_minutes" integer DEFAULT 15 NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"min_notice_minutes" integer DEFAULT 120 NOT NULL,
	"horizon_days" integer DEFAULT 60 NOT NULL,
	"cancel_cutoff_minutes" integer DEFAULT 120 NOT NULL,
	"reschedule_cutoff_minutes" integer DEFAULT 120 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_pages_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "booking_pages_id_owner" UNIQUE("id","organizer_id"),
	CONSTRAINT "booking_pages_title" CHECK (length(trim("slotly"."booking_pages"."title")) between 1 and 120),
	CONSTRAINT "booking_pages_description" CHECK (length("slotly"."booking_pages"."description") <= 4000),
	CONSTRAINT "booking_pages_state" CHECK ("slotly"."booking_pages"."state" in ('draft', 'published', 'paused', 'archived')),
	CONSTRAINT "booking_pages_duration" CHECK ("slotly"."booking_pages"."duration_minutes" between 5 and 480 and "slotly"."booking_pages"."duration_minutes" % 5 = 0),
	CONSTRAINT "booking_pages_step" CHECK ("slotly"."booking_pages"."step_minutes" between 5 and 120 and "slotly"."booking_pages"."step_minutes" % 5 = 0),
	CONSTRAINT "booking_pages_buffers" CHECK ("slotly"."booking_pages"."buffer_before_minutes" between 0 and 240 and "slotly"."booking_pages"."buffer_before_minutes" % 5 = 0 and "slotly"."booking_pages"."buffer_after_minutes" between 0 and 240 and "slotly"."booking_pages"."buffer_after_minutes" % 5 = 0),
	CONSTRAINT "booking_pages_notice" CHECK ("slotly"."booking_pages"."min_notice_minutes" between 0 and 43200),
	CONSTRAINT "booking_pages_horizon" CHECK ("slotly"."booking_pages"."horizon_days" between 1 and 365),
	CONSTRAINT "booking_pages_cutoffs" CHECK ("slotly"."booking_pages"."cancel_cutoff_minutes" between 0 and 43200 and "slotly"."booking_pages"."reschedule_cutoff_minutes" between 0 and 43200),
	CONSTRAINT "booking_pages_version" CHECK ("slotly"."booking_pages"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "slotly"."booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" varchar(12) NOT NULL,
	"actor" varchar(12) NOT NULL,
	"reason" text,
	"old_start_at" timestamp with time zone,
	"old_end_at" timestamp with time zone,
	"new_start_at" timestamp with time zone,
	"new_end_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_events_version" UNIQUE("booking_id","version"),
	CONSTRAINT "booking_events_version_positive" CHECK ("slotly"."booking_events"."version" > 0),
	CONSTRAINT "booking_events_type" CHECK ("slotly"."booking_events"."type" in ('created', 'rescheduled', 'cancelled')),
	CONSTRAINT "booking_events_actor" CHECK ("slotly"."booking_events"."actor" in ('guest', 'organizer', 'system')),
	CONSTRAINT "booking_events_reason" CHECK (("slotly"."booking_events"."reason" is null or length(trim("slotly"."booking_events"."reason")) between 1 and 1000) and ("slotly"."booking_events"."type" = 'cancelled' or "slotly"."booking_events"."reason" is null) and ("slotly"."booking_events"."type" <> 'cancelled' or "slotly"."booking_events"."actor" <> 'organizer' or "slotly"."booking_events"."reason" is not null)),
	CONSTRAINT "booking_events_shape" CHECK ((
    ("slotly"."booking_events"."type" = 'created' and "slotly"."booking_events"."version" = 1 and "slotly"."booking_events"."old_start_at" is null and "slotly"."booking_events"."old_end_at" is null and "slotly"."booking_events"."new_start_at" is not null and "slotly"."booking_events"."new_end_at" is not null) or
    ("slotly"."booking_events"."type" = 'rescheduled' and "slotly"."booking_events"."version" > 1 and "slotly"."booking_events"."old_start_at" is not null and "slotly"."booking_events"."old_end_at" is not null and "slotly"."booking_events"."new_start_at" is not null and "slotly"."booking_events"."new_end_at" is not null and "slotly"."booking_events"."old_start_at" <> "slotly"."booking_events"."new_start_at") or
    ("slotly"."booking_events"."type" = 'cancelled' and "slotly"."booking_events"."version" > 1 and "slotly"."booking_events"."old_start_at" is not null and "slotly"."booking_events"."old_end_at" is not null and "slotly"."booking_events"."new_start_at" is null and "slotly"."booking_events"."new_end_at" is null)
  )),
	CONSTRAINT "booking_events_bounds" CHECK (("slotly"."booking_events"."old_start_at" is null or (isfinite("slotly"."booking_events"."old_start_at") and isfinite("slotly"."booking_events"."old_end_at") and "slotly"."booking_events"."old_start_at" < "slotly"."booking_events"."old_end_at")) and ("slotly"."booking_events"."new_start_at" is null or (isfinite("slotly"."booking_events"."new_start_at") and isfinite("slotly"."booking_events"."new_end_at") and "slotly"."booking_events"."new_start_at" < "slotly"."booking_events"."new_end_at")))
);
--> statement-breakpoint
CREATE TABLE "slotly"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"occupancy_id" uuid NOT NULL,
	"occupancy_kind" varchar(8) DEFAULT 'booking' NOT NULL,
	"guest_name" varchar(100) NOT NULL,
	"guest_email" varchar(254) NOT NULL,
	"email_verified_at" timestamp with time zone NOT NULL,
	"guest_timezone" varchar(64) NOT NULL,
	"locale" varchar(8) DEFAULT 'ru' NOT NULL,
	"title_snapshot" varchar(120) NOT NULL,
	"location_snapshot" varchar(1000) NOT NULL,
	"schedule_timezone_snapshot" varchar(64) NOT NULL,
	"min_notice_minutes" integer NOT NULL,
	"horizon_days" integer NOT NULL,
	"cancel_cutoff_minutes" integer NOT NULL,
	"reschedule_cutoff_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_occupancy_id_unique" UNIQUE("occupancy_id"),
	CONSTRAINT "bookings_id_owner" UNIQUE("id","organizer_id"),
	CONSTRAINT "bookings_occupancy_kind" CHECK ("slotly"."bookings"."occupancy_kind" = 'booking'),
	CONSTRAINT "bookings_guest_name" CHECK (length(trim("slotly"."bookings"."guest_name")) between 1 and 100),
	CONSTRAINT "bookings_guest_email" CHECK (length("slotly"."bookings"."guest_email") between 3 and 254 and "slotly"."bookings"."guest_email" = lower(trim("slotly"."bookings"."guest_email")) and position('@' in "slotly"."bookings"."guest_email") > 1),
	CONSTRAINT "bookings_verified_finite" CHECK (isfinite("slotly"."bookings"."email_verified_at")),
	CONSTRAINT "bookings_zones" CHECK (slotly.is_known_timezone("slotly"."bookings"."guest_timezone") and slotly.is_known_timezone("slotly"."bookings"."schedule_timezone_snapshot")),
	CONSTRAINT "bookings_locale" CHECK ("slotly"."bookings"."locale" in ('ru', 'en')),
	CONSTRAINT "bookings_title" CHECK (length(trim("slotly"."bookings"."title_snapshot")) between 1 and 120),
	CONSTRAINT "bookings_notice" CHECK ("slotly"."bookings"."min_notice_minutes" between 0 and 43200),
	CONSTRAINT "bookings_horizon" CHECK ("slotly"."bookings"."horizon_days" between 1 and 365),
	CONSTRAINT "bookings_cutoffs" CHECK ("slotly"."bookings"."cancel_cutoff_minutes" between 0 and 43200 and "slotly"."bookings"."reschedule_cutoff_minutes" between 0 and 43200)
);
--> statement-breakpoint
CREATE TABLE "slotly"."occupancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"kind" varchar(8) NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"busy_start_at" timestamp with time zone NOT NULL,
	"busy_end_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"note" varchar(1000),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occupancies_id_owner_kind" UNIQUE("id","organizer_id","kind"),
	CONSTRAINT "occupancies_kind" CHECK ("slotly"."occupancies"."kind" in ('booking', 'manual')),
	CONSTRAINT "occupancies_bounds" CHECK ("slotly"."occupancies"."start_at" < "slotly"."occupancies"."end_at" and isfinite("slotly"."occupancies"."start_at") and isfinite("slotly"."occupancies"."end_at") and isfinite("slotly"."occupancies"."busy_start_at") and isfinite("slotly"."occupancies"."busy_end_at")),
	CONSTRAINT "occupancies_minute_precision" CHECK (date_trunc('minute', "slotly"."occupancies"."start_at") = "slotly"."occupancies"."start_at" and date_trunc('minute', "slotly"."occupancies"."end_at") = "slotly"."occupancies"."end_at"),
	CONSTRAINT "occupancies_buffers" CHECK ("slotly"."occupancies"."buffer_before_minutes" between 0 and 240 and "slotly"."occupancies"."buffer_before_minutes" % 5 = 0 and "slotly"."occupancies"."buffer_after_minutes" between 0 and 240 and "slotly"."occupancies"."buffer_after_minutes" % 5 = 0),
	CONSTRAINT "occupancies_busy_bounds" CHECK ("slotly"."occupancies"."start_at" - "slotly"."occupancies"."busy_start_at" = make_interval(mins => "slotly"."occupancies"."buffer_before_minutes") and "slotly"."occupancies"."busy_end_at" - "slotly"."occupancies"."end_at" = make_interval(mins => "slotly"."occupancies"."buffer_after_minutes")),
	CONSTRAINT "occupancies_duration" CHECK ("slotly"."occupancies"."kind" = 'manual' or (extract(epoch from ("slotly"."occupancies"."end_at" - "slotly"."occupancies"."start_at")) between 300 and 28800 and mod(extract(epoch from ("slotly"."occupancies"."end_at" - "slotly"."occupancies"."start_at")), 300) = 0)),
	CONSTRAINT "occupancies_manual_buffers" CHECK ("slotly"."occupancies"."kind" <> 'manual' or ("slotly"."occupancies"."buffer_before_minutes" = 0 and "slotly"."occupancies"."buffer_after_minutes" = 0)),
	CONSTRAINT "occupancies_release_finite" CHECK ("slotly"."occupancies"."released_at" is null or isfinite("slotly"."occupancies"."released_at")),
	CONSTRAINT "occupancies_version" CHECK ("slotly"."occupancies"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "slotly"."date_overrides" ADD CONSTRAINT "date_overrides_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "slotly"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."override_windows" ADD CONSTRAINT "override_windows_parent" FOREIGN KEY ("override_id","override_mode") REFERENCES "slotly"."date_overrides"("id","mode") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."schedules" ADD CONSTRAINT "schedules_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "slotly"."organizers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."weekly_windows" ADD CONSTRAINT "weekly_windows_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "slotly"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."booking_pages" ADD CONSTRAINT "booking_pages_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "slotly"."organizers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."booking_pages" ADD CONSTRAINT "booking_pages_schedule_owner" FOREIGN KEY ("schedule_id","organizer_id") REFERENCES "slotly"."schedules"("id","organizer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."booking_events" ADD CONSTRAINT "booking_events_booking_owner" FOREIGN KEY ("booking_id","organizer_id") REFERENCES "slotly"."bookings"("id","organizer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."bookings" ADD CONSTRAINT "bookings_page_owner" FOREIGN KEY ("page_id","organizer_id") REFERENCES "slotly"."booking_pages"("id","organizer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."bookings" ADD CONSTRAINT "bookings_occupancy_owner_kind" FOREIGN KEY ("occupancy_id","organizer_id","occupancy_kind") REFERENCES "slotly"."occupancies"("id","organizer_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slotly"."occupancies" ADD CONSTRAINT "occupancies_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "slotly"."organizers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_pages_owner_state" ON "slotly"."booking_pages" USING btree ("organizer_id","state");--> statement-breakpoint
CREATE INDEX "bookings_owner_created" ON "slotly"."bookings" USING btree ("organizer_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_page" ON "slotly"."bookings" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "occupancies_owner_start" ON "slotly"."occupancies" USING btree ("organizer_id","start_at");
