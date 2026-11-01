import Link from "next/link";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";
import type { MeetingSummary } from "../dashboard-service";
import { WorkspaceIcon } from "./workspace-icon";
import "./booking-list.css";

export function MeetingCard({ meeting, now, compact = false, displayTimezone = meeting.timezone }: { meeting: MeetingSummary; now: Date; compact?: boolean; displayTimezone?: string }) {
  const format = new Intl.DateTimeFormat("ru-RU", { timeZone: meeting.timezone, year: "numeric", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" });
  const ongoing = !meeting.cancelledAt && meeting.startAt <= now && meeting.endAt > now;
  const done = !meeting.cancelledAt && meeting.endAt <= now;
  const status = meeting.cancelledAt ? t.cancelled : ongoing ? t.ongoing : done ? t.finished : t.confirmed;
  if (compact) {
    const date = new Intl.DateTimeFormat("ru-RU", { timeZone: displayTimezone, day: "numeric", month: "short" });
    const time = new Intl.DateTimeFormat("ru-RU", { timeZone: displayTimezone, hour: "2-digit", minute: "2-digit" });
    const sameDay = date.format(meeting.startAt) === date.format(meeting.endAt);
    return <article className="overview-meeting-card workspace-surface">
      <span className="overview-card-icon"><WorkspaceIcon name="calendar" /></span><div className="overview-meeting-info">
        <div className="overview-meeting-title"><h3><Link href={`/dashboard/bookings/${meeting.id}`}>{meeting.title}</Link></h3><span className="overview-meeting-status" data-muted={Boolean(meeting.cancelledAt || done)}>{status}</span></div>
        <p className="overview-meeting-time"><time dateTime={meeting.startAt.toISOString()}>{date.format(meeting.startAt)}, {time.format(meeting.startAt)}</time><span>—</span><time dateTime={meeting.endAt.toISOString()}>{!sameDay && `${date.format(meeting.endAt)}, `}{time.format(meeting.endAt)}</time><span className="overview-duration"><WorkspaceIcon name="clock" />{Math.round((meeting.endAt.getTime() - meeting.startAt.getTime()) / 60_000)} {t.minutesShort}</span></p>
        <p className="overview-meeting-guest">{meeting.guestName}<span> · {displayTimezone}</span></p>
      </div><Link href={`/dashboard/bookings/${meeting.id}`} className="workspace-icon-button overview-meeting-open" aria-label={`${t.details}: ${meeting.title}, ${meeting.guestName}`}><WorkspaceIcon name="chevron" /></Link>
    </article>;
  }
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone: meeting.timezone, day: "numeric", month: "short", year: "numeric" });
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: meeting.timezone, hour: "2-digit", minute: "2-digit" });
  const startParts = date.formatToParts(meeting.startAt), endParts = date.formatToParts(meeting.endAt);
  const sameDay = date.format(meeting.startAt) === date.format(meeting.endAt);
  const sameYear = startParts.find(p => p.type === "year")?.value === endParts.find(p => p.type === "year")?.value;
  const shortDate = (parts: Intl.DateTimeFormatPart[], year = true) => parts.filter(p => p.type === "day" || p.type === "month" || year && p.type === "year").map(p => p.value).join(" ");
  const offset = (value: Date) => format.formatToParts(value).find(p => p.type === "timeZoneName")?.value ?? "";
  const startOffset = offset(meeting.startAt), endOffset = offset(meeting.endAt);
  const kind = meeting.cancelledAt ? "cancelled" : ongoing ? "ongoing" : done ? "finished" : "confirmed";
  return <article className="booking-list-card">
    <h2 className="booking-list-title"><Link href={`/dashboard/bookings/${meeting.id}`}>{meeting.title}</Link></h2>
    <span className="booking-list-status" data-kind={kind}><i aria-hidden="true" />{status}</span>
    <div className="booking-list-when" title={`${format.format(meeting.startAt)} — ${format.format(meeting.endAt)}`}>
      <p className="booking-list-date"><WorkspaceIcon name="calendar" /><time dateTime={meeting.startAt.toISOString()}>{shortDate(startParts)}</time></p>
      <p className="booking-list-time"><time dateTime={meeting.startAt.toISOString()}>{time.format(meeting.startAt)}</time><span className="booking-list-dash">–</span><time dateTime={meeting.endAt.toISOString()}>{!sameDay && <span className="booking-list-end-date">{shortDate(endParts, !sameYear)}, </span>}{time.format(meeting.endAt)}</time></p>
      <p className="booking-list-zone"><span>{meeting.timezone}</span><span>{startOffset}{startOffset !== endOffset && ` → ${endOffset}`}</span></p>
    </div>
    <div className="booking-list-guest"><p>{meeting.guestName}</p><p>{meeting.guestEmail}</p></div>
    <Link href={`/dashboard/bookings/${meeting.id}`} aria-label={`${t.details}: ${meeting.title}, ${meeting.guestName}`} className="booking-list-details">{t.details}<WorkspaceIcon name="chevron" /></Link>
  </article>;
}
