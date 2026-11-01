-- Custom constraints and functions intentionally live in versioned SQL:
-- Drizzle Kit does not represent exclusion constraints or constraint triggers.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE slotly.occupancies ADD CONSTRAINT occupancies_no_overlap
EXCLUDE USING gist (
  organizer_id WITH =,
  tstzrange(busy_start_at, busy_end_at, '[)') WITH &&
) WHERE (released_at IS NULL);
--> statement-breakpoint
ALTER TABLE slotly.weekly_windows ADD CONSTRAINT weekly_windows_no_overlap
EXCLUDE USING gist (
  schedule_id WITH =, weekday WITH =,
  int4range(start_minute, end_minute, '[)') WITH &&
);
--> statement-breakpoint
ALTER TABLE slotly.override_windows ADD CONSTRAINT override_windows_no_overlap
EXCLUDE USING gist (
  override_id WITH =, int4range(start_minute, end_minute, '[)') WITH &&
);
--> statement-breakpoint
CREATE FUNCTION slotly.guard_occupancy_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
DECLARE changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.released_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'occupancies_initial_state',
        MESSAGE = 'New occupancy must start active at version 1';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.organizer_id, NEW.kind, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.organizer_id, OLD.kind, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'occupancies_immutable_identity',
      MESSAGE = 'Occupancy identity is immutable';
  END IF;
  changed := ROW(NEW.start_at, NEW.end_at, NEW.busy_start_at, NEW.busy_end_at,
                  NEW.buffer_before_minutes, NEW.buffer_after_minutes, NEW.released_at, NEW.note)
     IS DISTINCT FROM ROW(OLD.start_at, OLD.end_at, OLD.busy_start_at, OLD.busy_end_at,
                  OLD.buffer_before_minutes, OLD.buffer_after_minutes, OLD.released_at, OLD.note);
  IF OLD.released_at IS NOT NULL AND changed THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'occupancies_final_release',
      MESSAGE = 'Released occupancy cannot be changed or restored';
  END IF;
  IF OLD.kind = 'booking' AND (
    NEW.end_at - NEW.start_at <> OLD.end_at - OLD.start_at OR
    ROW(NEW.buffer_before_minutes, NEW.buffer_after_minutes, NEW.note)
      IS DISTINCT FROM ROW(OLD.buffer_before_minutes, OLD.buffer_after_minutes, OLD.note)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'occupancies_saved_conditions',
      MESSAGE = 'Booked duration and buffers are immutable';
  END IF;
  IF NEW.released_at IS NOT NULL AND OLD.released_at IS NULL AND
     ROW(NEW.start_at, NEW.end_at, NEW.busy_start_at, NEW.busy_end_at,
         NEW.buffer_before_minutes, NEW.buffer_after_minutes, NEW.note)
       IS DISTINCT FROM ROW(OLD.start_at, OLD.end_at, OLD.busy_start_at, OLD.busy_end_at,
         OLD.buffer_before_minutes, OLD.buffer_after_minutes, OLD.note) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'occupancies_release_only',
      MESSAGE = 'Release and reschedule must be separate transitions';
  END IF;
  IF NEW.version <> OLD.version + (CASE WHEN changed THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'occupancies_version_transition',
      MESSAGE = 'Occupancy transition must increment version exactly once';
  END IF;
  RETURN NEW;
END;
$body$;
--> statement-breakpoint
CREATE TRIGGER occupancies_transition
BEFORE INSERT OR UPDATE ON slotly.occupancies
FOR EACH ROW EXECUTE FUNCTION slotly.guard_occupancy_transition();
--> statement-breakpoint
CREATE FUNCTION slotly.reject_immutable_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'immutable_record',
    MESSAGE = 'Booking snapshots and history are immutable';
END;
$body$;
--> statement-breakpoint
CREATE TRIGGER bookings_immutable BEFORE UPDATE OR DELETE ON slotly.bookings
FOR EACH ROW EXECUTE FUNCTION slotly.reject_immutable_row();
--> statement-breakpoint
CREATE TRIGGER booking_events_immutable BEFORE UPDATE OR DELETE ON slotly.booking_events
FOR EACH ROW EXECUTE FUNCTION slotly.reject_immutable_row();
--> statement-breakpoint
CREATE FUNCTION slotly.guard_booking_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
DECLARE
  previous slotly.booking_events%ROWTYPE;
  occupied slotly.occupancies%ROWTYPE;
BEGIN
  SELECT o.* INTO occupied FROM slotly.occupancies o
    JOIN slotly.bookings b ON b.occupancy_id = o.id WHERE b.id = NEW.booking_id;
  IF NOT FOUND OR occupied.version <> NEW.version THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'booking_events_current_version',
      MESSAGE = 'History event must match the current occupancy version';
  END IF;
  IF occupied.released_at IS NULL THEN
    IF NEW.type NOT IN ('created', 'rescheduled') OR
       ROW(NEW.new_start_at, NEW.new_end_at) IS DISTINCT FROM ROW(occupied.start_at, occupied.end_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'booking_events_current_time',
        MESSAGE = 'History event must match active occupancy';
    END IF;
  ELSE
    IF NEW.type <> 'cancelled' OR
       ROW(NEW.old_start_at, NEW.old_end_at) IS DISTINCT FROM ROW(occupied.start_at, occupied.end_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'booking_events_current_time',
        MESSAGE = 'Cancellation event must match released occupancy';
    END IF;
  END IF;
  IF NEW.version > 1 THEN
    SELECT * INTO previous FROM slotly.booking_events
      WHERE booking_id = NEW.booking_id AND version = NEW.version - 1;
    IF NOT FOUND OR previous.type = 'cancelled' OR
       ROW(NEW.old_start_at, NEW.old_end_at) IS DISTINCT FROM ROW(previous.new_start_at, previous.new_end_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'booking_events_chain',
        MESSAGE = 'History must continue the previous event';
    END IF;
    IF NEW.type = 'rescheduled' AND
       NEW.new_end_at - NEW.new_start_at <> NEW.old_end_at - NEW.old_start_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'booking_events_duration',
        MESSAGE = 'History cannot change booked duration';
    END IF;
  END IF;
  RETURN NEW;
END;
$body$;
--> statement-breakpoint
CREATE TRIGGER booking_events_chain BEFORE INSERT ON slotly.booking_events
FOR EACH ROW EXECUTE FUNCTION slotly.guard_booking_event();
--> statement-breakpoint
CREATE FUNCTION slotly.assert_booking_consistency() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
DECLARE
  occupancy_key uuid;
  occupied slotly.occupancies%ROWTYPE;
  booked slotly.bookings%ROWTYPE;
  latest slotly.booking_events%ROWTYPE;
  event_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'occupancies' THEN
    occupancy_key := NEW.id;
  ELSIF TG_TABLE_NAME = 'bookings' THEN
    occupancy_key := NEW.occupancy_id;
  ELSE
    SELECT occupancy_id INTO occupancy_key FROM slotly.bookings WHERE id = NEW.booking_id;
  END IF;
  SELECT * INTO occupied FROM slotly.occupancies WHERE id = occupancy_key;
  IF NOT FOUND OR occupied.kind <> 'booking' THEN RETURN NULL; END IF;
  SELECT * INTO booked FROM slotly.bookings WHERE occupancy_id = occupied.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'booking_occupancy_pair',
      MESSAGE = 'Booking occupancy must have exactly one booking at commit';
  END IF;
  SELECT count(*) INTO event_count FROM slotly.booking_events WHERE booking_id = booked.id;
  SELECT * INTO latest FROM slotly.booking_events WHERE booking_id = booked.id AND version = occupied.version;
  IF NOT FOUND OR event_count <> occupied.version THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'booking_history_complete',
      MESSAGE = 'Every booking transition requires a history event in the same transaction';
  END IF;
  IF occupied.released_at IS NULL THEN
    IF latest.type <> (CASE WHEN occupied.version = 1 THEN 'created' ELSE 'rescheduled' END) OR
       ROW(latest.new_start_at, latest.new_end_at) IS DISTINCT FROM ROW(occupied.start_at, occupied.end_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'booking_history_state',
        MESSAGE = 'Latest history event must match active occupancy';
    END IF;
  ELSE
    IF latest.type <> 'cancelled' OR
       ROW(latest.old_start_at, latest.old_end_at) IS DISTINCT FROM ROW(occupied.start_at, occupied.end_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'booking_history_state',
        MESSAGE = 'Latest history event must match cancellation';
    END IF;
  END IF;
  RETURN NULL;
END;
$body$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER occupancies_booking_consistency AFTER INSERT OR UPDATE ON slotly.occupancies
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slotly.assert_booking_consistency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bookings_consistency AFTER INSERT ON slotly.bookings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slotly.assert_booking_consistency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER booking_events_consistency AFTER INSERT ON slotly.booking_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slotly.assert_booking_consistency();
--> statement-breakpoint
-- Serialize child-window mutations on their parent. Without this lock two
-- concurrent deletes could each see the other window and leave a replacement empty.
CREATE FUNCTION slotly.lock_override_windows_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
DECLARE keys uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN keys := ARRAY[OLD.override_id];
  ELSIF TG_OP = 'UPDATE' THEN keys := ARRAY[OLD.override_id, NEW.override_id];
  ELSE keys := ARRAY[NEW.override_id];
  END IF;
  PERFORM id FROM slotly.date_overrides WHERE id = ANY(keys) ORDER BY id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$body$;
--> statement-breakpoint
CREATE TRIGGER override_windows_lock_parent BEFORE INSERT OR UPDATE OR DELETE ON slotly.override_windows
FOR EACH ROW EXECUTE FUNCTION slotly.lock_override_windows_parent();
--> statement-breakpoint
CREATE FUNCTION slotly.assert_override_windows() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
DECLARE keys uuid[]; key uuid; override_mode text; window_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'date_overrides' THEN
    keys := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    keys := ARRAY[OLD.override_id];
  ELSIF TG_OP = 'UPDATE' THEN
    keys := ARRAY[OLD.override_id, NEW.override_id];
  ELSE
    keys := ARRAY[NEW.override_id];
  END IF;
  FOREACH key IN ARRAY keys LOOP
    SELECT mode INTO override_mode FROM slotly.date_overrides WHERE id = key;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT count(*) INTO window_count FROM slotly.override_windows WHERE override_id = key;
    IF (override_mode = 'replace' AND window_count = 0) OR
       (override_mode = 'closed' AND window_count <> 0) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'date_overrides_windows',
        MESSAGE = 'Closed dates have no windows; replacement dates require windows';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$body$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER date_overrides_windows AFTER INSERT OR UPDATE ON slotly.date_overrides
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slotly.assert_override_windows();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER override_windows_required AFTER INSERT OR UPDATE OR DELETE ON slotly.override_windows
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slotly.assert_override_windows();
