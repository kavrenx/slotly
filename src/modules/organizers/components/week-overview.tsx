"use client";
import Link from "next/link";
import { useLinkStatus } from "next/link";
import type { CSSProperties } from "react";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";
import { dashboardDateLabel, dashboardHref } from "../dashboard-week";
import { WorkspaceIcon } from "./workspace-icon";

type Week = { today: string; selectedDate: string; filtered: boolean; days: { date: string; count: number }[]; previous: string | null; next: string | null };
function DayLabel({ date, count }: { date: string; count: number }) {
  const { pending } = useLinkStatus();
  return <><span className="week-day-name">{dashboardDateLabel(date, { weekday: "short" })}</span><span className="week-day-number">{Number(date.slice(8))}</span><span className="week-day-mark" data-count={count > 0} data-pending={pending} aria-hidden="true" /></>;
}
export function WeekOverview({ week, timezone }: { week: Week; timezone: string }) {
  const first = week.days[0]!.date, last = week.days[6]!.date;
  const range = `${dashboardDateLabel(first, { day: "numeric", month: "short" })} — ${dashboardDateLabel(last, { day: "numeric", month: "short", year: "numeric" })}`;
  return <section className="overview-week workspace-surface" aria-labelledby="week-title">
    <div className="overview-section-heading"><h2 id="week-title">{t.week}</h2><div className="week-controls"><span className="week-range">{range}</span>
      {week.previous ? <Link href={dashboardHref(week.previous)} scroll={false} prefetch={false} className="workspace-icon-button" aria-label={t.previousWeek}><WorkspaceIcon name="chevron" className="rotate-180" /></Link> : <span />}
      {week.next ? <Link href={dashboardHref(week.next)} scroll={false} prefetch={false} className="workspace-icon-button" aria-label={t.nextWeek}><WorkspaceIcon name="chevron" /></Link> : <span />}
    </div></div>
    <nav className="week-days" aria-label={t.weekDays} style={{ "--selected-day": week.days.findIndex(day => day.date === week.selectedDate) } as CSSProperties}>
      <span className="week-selection" aria-hidden="true" />
      {week.days.map(day => <Link key={day.date} href={dashboardHref(day.date)} prefetch={false} scroll={false} className="week-day" data-today={day.date === week.today}
        aria-current={day.date === week.selectedDate ? "date" : undefined}
        aria-label={`${dashboardDateLabel(day.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} ${t.meetingsCount}: ${day.count}${day.date === week.today ? `. ${t.todayLabel}` : ""}`}>
        <DayLabel date={day.date} count={day.count} />
      </Link>)}
    </nav>
    <div className="week-footer"><span>{timezone}</span><Link href={dashboardHref(week.today)} scroll={false} prefetch={false}>{t.todayLabel}<WorkspaceIcon name="chevron" /></Link></div>
  </section>;
}
