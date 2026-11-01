import Link from "next/link";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";
import type { MeetingSummary } from "../dashboard-service";
import { WorkspaceIcon } from "./workspace-icon";

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
  return <article className="min-w-0 rounded-2xl border border-line bg-paper p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 className="min-w-0 text-lg font-medium wrap-break-word"><Link href={`/dashboard/bookings/${meeting.id}`} className="underline-offset-4 hover:text-accent hover:underline">{meeting.title}</Link></h2>
      <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${meeting.cancelledAt || done ? "bg-panel text-muted" : "bg-accent/10 text-accent"}`}>{status}</span>
    </div>
    <p className="mt-4 text-sm leading-7"><time dateTime={meeting.startAt.toISOString()}>{format.format(meeting.startAt)}</time><span className="text-muted"> — </span><time dateTime={meeting.endAt.toISOString()}>{format.format(meeting.endAt)}</time></p>
    <p className="mt-1 text-xs text-muted">{meeting.timezone}</p>
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4"><div className="min-w-0"><p className="text-sm font-medium wrap-break-word">{meeting.guestName}</p><p className="mt-1 text-sm wrap-break-word text-muted">{meeting.guestEmail}</p></div>
      <Link href={`/dashboard/bookings/${meeting.id}`} aria-label={`${t.details}: ${meeting.title}, ${meeting.guestName}`} className="inline-flex min-h-11 items-center gap-3 text-sm font-medium text-accent hover:underline">{t.details}<span aria-hidden="true">↗</span></Link>
    </div>
  </article>;
}
