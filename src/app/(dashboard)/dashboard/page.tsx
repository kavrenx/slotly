import Link from "next/link";
import { primaryButton } from "@/components/ui/form";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";
import { requireOrganizer } from "@/modules/organizers/server";
import { getDashboardOverview } from "@/modules/organizers/dashboard-service";
import { MeetingCard } from "@/modules/organizers/components/meeting-card";
import { RefreshDashboard } from "@/modules/organizers/components/refresh-dashboard";
import { getDatabase } from "@/server/db/client";

export default async function DashboardPage() {
  const organizer = await requireOrganizer();
  const data = await getDashboardOverview(getDatabase(), organizer.id);
  const { progress } = data;
  const ready = progress.hours && progress.published;
  const status = [progress.hours, progress.page, progress.published];
  const hrefs = ["/dashboard/schedule", progress.hours ? progress.pageHref : "/dashboard/schedule", progress.hours ? progress.pageHref : "/dashboard/schedule"];
  const action = !progress.hours ? t.hoursAction : !progress.page ? t.pageAction : t.publishAction;
  const actionHref = !progress.hours ? hrefs[0]! : !progress.page ? hrefs[1]! : hrefs[2]!;
  return <div className="max-w-5xl">
    <p className="text-xs font-semibold tracking-widest text-accent uppercase">{t.overview}</p>
    <div className="mt-3 flex flex-wrap items-start justify-between gap-5"><div className="min-w-0"><h1 className="text-3xl font-medium tracking-tight wrap-break-word sm:text-4xl">{t.greeting}, {organizer.displayName}!</h1><p className="mt-4 text-sm leading-7 text-muted">{t.description}</p></div>
      <div className="flex flex-wrap gap-3"><RefreshDashboard />{ready && <Link href="/dashboard/pages" className={primaryButton}>{t.shareAction}<span aria-hidden="true">↗</span></Link>}</div>
    </div>
    {!ready && <section className="mt-8 rounded-3xl border border-line bg-panel/60 p-5 sm:p-8" aria-labelledby="setup-heading">
      <div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-xl"><h2 id="setup-heading" className="text-xl font-medium">{progress.published ? t.scheduleWarning : t.setupTitle}</h2><p className="mt-2 text-sm leading-7 text-muted">{progress.published ? t.scheduleWarningHint : t.setupHint}</p></div><Link href={actionHref} className={primaryButton}>{action}<span aria-hidden="true">↗</span></Link></div>
      <ol className="mt-6 grid gap-3 lg:grid-cols-3">{t.steps.map((label, i) => <li key={label} className="flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-paper p-4"><span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${status[i] ? "bg-accent text-white" : "bg-panel text-muted"}`}>{status[i] ? "✓" : i + 1}</span><div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs leading-6 text-muted">{[t.hoursHint, t.pageHint, t.publishHint][i]}</p><Link href={hrefs[i]!} className="mt-2 inline-flex min-h-9 items-center gap-2 text-xs font-medium text-accent underline-offset-4 hover:underline"><span className="sr-only">{label}: </span>{status[i] ? t.complete : t.open}<span aria-hidden="true">↗</span></Link></div></li>)}</ol>
    </section>}
    <dl className="mt-8 grid gap-3 sm:grid-cols-3">{[{ label: t.today, value: data.counts.today }, { label: t.upcoming, value: data.counts.upcoming }, { label: t.published, value: data.pages.filter(p => p.state === "published").length }].map(stat => <div key={stat.label} className="rounded-2xl border border-line p-5 sm:p-6"><dt className="text-sm text-muted">{stat.label}</dt><dd className="mt-3 text-4xl font-medium tracking-tight tabular-nums">{stat.value}</dd></div>)}</dl>
    <p className="mt-3 text-xs leading-6 text-muted">{new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone, day: "numeric", month: "long", year: "numeric" }).format(data.generatedAt)} · {t.timezone}: {data.timezone}</p>
    <section className="mt-9" aria-labelledby="next-meetings"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="next-meetings" className="text-xl font-medium">{t.next}</h2><Link href="/dashboard/bookings" className="inline-flex min-h-11 items-center gap-3 text-sm font-medium text-accent hover:underline">{t.all}<span aria-hidden="true">↗</span></Link></div>
      {data.next.length ? <div className="mt-4 space-y-4">{data.next.map(meeting => <MeetingCard key={meeting.id} meeting={meeting} now={data.generatedAt} />)}</div>
        : <div className="mt-4 rounded-2xl border border-dashed border-line bg-panel/40 p-6"><h3 className="text-base font-medium">{t.noNext}</h3><p className="mt-2 max-w-xl text-sm leading-7 text-muted">{t.noNextHint}</p></div>}
    </section>
    {ready && <section className="mt-7 flex flex-wrap items-center justify-between gap-5 rounded-2xl bg-ink p-6 text-paper"><div className="max-w-lg"><h2 className="text-base font-medium">{t.ready}</h2><p className="mt-2 text-sm leading-7 text-paper/75">{t.readyHint}</p></div><Link href="/dashboard/pages" className="inline-flex min-h-11 items-center gap-3 rounded-xl bg-paper px-4 py-3 text-sm font-medium text-ink">{t.shareAction}<span aria-hidden="true">↗</span></Link></section>}
  </div>;
}
