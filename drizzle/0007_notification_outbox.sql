CREATE TABLE "slotly"."notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"audience" varchar(12) NOT NULL,
	"recipient_email" varchar(254) NOT NULL,
	"recipient_timezone" varchar(64) NOT NULL,
	"organizer_name" varchar(100) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"locked_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_event_audience" UNIQUE("event_id","audience"),
	CONSTRAINT "notification_outbox_audience" CHECK ("slotly"."notification_outbox"."audience" in ('guest', 'organizer')),
	CONSTRAINT "notification_outbox_recipient" CHECK (length(trim("slotly"."notification_outbox"."recipient_email")) between 3 and 254 and position('@' in "slotly"."notification_outbox"."recipient_email") > 1),
	CONSTRAINT "notification_outbox_timezone" CHECK (slotly.is_known_timezone("slotly"."notification_outbox"."recipient_timezone")),
	CONSTRAINT "notification_outbox_attempts" CHECK ("slotly"."notification_outbox"."attempts" between 0 and 8),
	CONSTRAINT "notification_outbox_lease" CHECK (("slotly"."notification_outbox"."lease_token" is null) = ("slotly"."notification_outbox"."locked_until" is null)),
	CONSTRAINT "notification_outbox_terminal" CHECK (not ("slotly"."notification_outbox"."sent_at" is not null and "slotly"."notification_outbox"."failed_at" is not null) and (("slotly"."notification_outbox"."sent_at" is null and "slotly"."notification_outbox"."failed_at" is null) or "slotly"."notification_outbox"."lease_token" is null)),
	CONSTRAINT "notification_outbox_finite" CHECK (isfinite("slotly"."notification_outbox"."available_at") and isfinite("slotly"."notification_outbox"."created_at") and ("slotly"."notification_outbox"."locked_until" is null or isfinite("slotly"."notification_outbox"."locked_until")) and ("slotly"."notification_outbox"."sent_at" is null or isfinite("slotly"."notification_outbox"."sent_at")) and ("slotly"."notification_outbox"."failed_at" is null or isfinite("slotly"."notification_outbox"."failed_at")))
);
--> statement-breakpoint
ALTER TABLE "slotly"."notification_outbox" ADD CONSTRAINT "notification_outbox_event_id_booking_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "slotly"."booking_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_outbox_due" ON "slotly"."notification_outbox" USING btree ("available_at") WHERE "slotly"."notification_outbox"."sent_at" is null and "slotly"."notification_outbox"."failed_at" is null;
--> statement-breakpoint
-- No backfill: deploying notifications never sends unsolicited historical mail.
CREATE FUNCTION slotly.enqueue_booking_notifications() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO slotly.notification_outbox
    (event_id, audience, recipient_email, recipient_timezone, organizer_name)
  SELECT NEW.id, 'guest', b.guest_email, b.guest_timezone, o.display_name
    FROM slotly.bookings b JOIN slotly.organizers o ON o.id = b.organizer_id
    WHERE b.id = NEW.booking_id
  UNION ALL
  SELECT NEW.id, 'organizer', u.email, COALESCE(s.timezone, b.schedule_timezone_snapshot), o.display_name
    FROM slotly.bookings b JOIN slotly.organizers o ON o.id = b.organizer_id
    JOIN slotly.auth_users u ON u.id = o.user_id
    LEFT JOIN slotly.schedules s ON s.organizer_id = o.id
    WHERE b.id = NEW.booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing notification recipients'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER booking_event_notifications AFTER INSERT ON slotly.booking_events
  FOR EACH ROW EXECUTE FUNCTION slotly.enqueue_booking_notifications();
--> statement-breakpoint
CREATE FUNCTION slotly.protect_notification_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.event_id, NEW.audience, NEW.recipient_email, NEW.recipient_timezone, NEW.organizer_name, NEW.created_at)
    IS DISTINCT FROM
     ROW(OLD.id, OLD.event_id, OLD.audience, OLD.recipient_email, OLD.recipient_timezone, OLD.organizer_name, OLD.created_at)
  THEN RAISE EXCEPTION 'Notification snapshot is immutable'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notification_snapshot BEFORE UPDATE ON slotly.notification_outbox
  FOR EACH ROW EXECUTE FUNCTION slotly.protect_notification_snapshot();
