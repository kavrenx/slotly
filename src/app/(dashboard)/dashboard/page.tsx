import Link from "next/link";
import { primaryButton } from "@/components/ui/form";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";
import { requireOrganizer } from "@/modules/organizers/server";
import { getDashboardOverview } from "@/modules/organizers/dashboard-service";
import { MeetingCard } from "@/modules/organizers/components/meeting-card";
import { RefreshDashboard } from "@/modules/organizers/components/refresh-dashboard";
import { WeekOverview } from "@/modules/organizers/components/week-overview";
import { WorkspaceIcon } from "@/modules/organizers/components/workspace-icon";
import { dashboardDateLabel, dashboardHref } from "@/modules/organizers/dashboard-week";
import { getDatabase } from "@/server/db/client";

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const organizer = await requireOrganizer();
  const query = await searchParams;
  const data = await getDashboardOverview(getDatabase(), organizer.id, new Date(), { date: query.date, dayPage: query.dayPage });
  const { progress, week } = data;
  const published = data.pages.filter(page => page.state === "published");
  const ready = progress.hours && progress.published;
  const status = [progress.hours, progress.page, progress.published];
  const hrefs = ["/dashboard/schedule", progress.hours ? progress.pageHref : "/dashboard/schedule", progress.hours ? progress.pageHref : "/dashboard/schedule"];
  const action = !progress.hours ? t.hoursAction : !progress.page ? t.pageAction : t.publishAction;
  const actionHref = !progress.hours ? hrefs[0]! : !progress.page ? hrefs[1]! : hrefs[2]!;
  const nearest = data.next[0];
  const nearestLabel = nearest ? new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(nearest.startAt) : t.noNearest;
  return <div className="dashboard-overview">
    <div className="overview-intro">
      <div className="overview-intro-copy"><p className="workspace-eyebrow">{t.overview}</p><h1>{t.greeting}, {organizer.displayName}!</h1><p>{t.description}</p></div>
      <svg className="overview-waves" viewBox="0 0 540 150" fill="none" aria-hidden="true"><path d="M0 134C85 43 122 131 206 88S323 8 401 47s85 30 139-18v121H0Z" fill="currentColor" opacity=".55" /><path d="M64 150c96-81 123-35 200-41S404-22 540 9v141Z" fill="currentColor" opacity=".45" /></svg>
    </div>
    <div className="overview-top-row">
      <dl className="overview-stats">
        <div className="overview-stat overview-stat-today workspace-surface"><dt><WorkspaceIcon name="calendar" />{t.today}</dt><dd>{data.counts.today}</dd><dd className="overview-stat-context">{t.todayHint}</dd></div>
        <div className="overview-stat workspace-surface"><dt><WorkspaceIcon name="clock" />{t.upcoming}</dt><dd>{data.counts.upcoming}</dd><dd className="overview-stat-context">{nearest ? <Link href={`/dashboard/bookings/${nearest.id}`}>{t.nearest}: {nearestLabel}</Link> : nearestLabel}</dd></div>
        <div className="overview-stat workspace-surface"><dt><WorkspaceIcon name="layers" />{t.pagesLabel}</dt><dd>{data.pages.filter(page => page.state !== "archived").length}</dd><dd className="overview-stat-context"><Link href="/dashboard/pages">{t.publishedCount}: {published.length}<WorkspaceIcon name="chevron" /></Link></dd></div>
      </dl>
      <nav className="overview-quick-actions" aria-label={t.quickActions}>
        <Link href="/dashboard/pages/new" className="overview-create"><span className="overview-action-icon"><WorkspaceIcon name="plus" /></span><span>{t.createPage}</span><WorkspaceIcon name="chevron" /></Link>
        <Link href="/dashboard/schedule" className="overview-schedule"><WorkspaceIcon name="calendar" /><span>{t.configureSchedule}</span><WorkspaceIcon name="chevron" /></Link>
      </nav>
    </div>
    {!ready && <section className="overview-setup workspace-surface" aria-labelledby="setup-heading">
      <div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-xl"><h2 id="setup-heading" className="text-xl font-medium">{progress.published ? t.scheduleWarning : t.setupTitle}</h2><p className="mt-2 text-sm leading-7 text-muted">{progress.published ? t.scheduleWarningHint : t.setupHint}</p></div><Link href={actionHref} className={primaryButton}>{action}<span aria-hidden="true">↗</span></Link></div>
      <ol className="overview-setup-steps">{t.steps.map((label, i) => <li key={label}><span aria-hidden="true" className={status[i] ? "is-complete" : ""}>{status[i] ? "✓" : i + 1}</span><div><p>{label}</p><Link href={hrefs[i]!}><span className="sr-only">{label}: </span>{status[i] ? t.complete : t.open} ↗</Link></div></li>)}</ol>
    </section>}
    <div className="overview-content-grid">
      <div className="overview-agenda">
        <WeekOverview week={week} timezone={data.timezone} />
        <section className="overview-meetings" aria-labelledby="next-meetings">
          <div className="overview-section-heading"><h2 id="next-meetings">{week.filtered ? t.dayMeetings : t.next}</h2><Link href="/dashboard/bookings" className="workspace-text-link">{t.all}<WorkspaceIcon name="chevron" /></Link></div>
          {week.filtered && <div className="overview-filter"><p>{dashboardDateLabel(week.selectedDate, { day: "numeric", month: "long", year: "numeric" })}<span> · {t.total}: {week.total}</span></p><Link href="/dashboard" scroll={false} className="workspace-text-link">{t.backToNext} ↗</Link></div>}
          <div className="overview-meetings-content" key={`${week.filtered ? week.selectedDate : "next"}-${week.page}`}>
            {week.meetings.length ? <div className="overview-meeting-list">{week.meetings.map(meeting => <MeetingCard key={meeting.id} compact meeting={meeting} now={data.generatedAt} displayTimezone={data.timezone} />)}</div>
              : <div className="overview-empty"><span className="overview-empty-icon"><WorkspaceIcon name="calendar" /></span><h3>{week.filtered ? t.noDay : t.noNext}</h3><p>{week.filtered ? t.noDayHint : t.noNextHint}</p>{!week.filtered && <Link href="/dashboard/pages" className="workspace-text-link">{t.myPages}<WorkspaceIcon name="chevron" /></Link>}</div>}
          </div>
          {week.filtered && week.totalPages > 1 && <nav className="overview-pagination" aria-label="Страницы встреч выбранного дня">
            {week.page > 1 ? <Link scroll={false} href={dashboardHref(week.selectedDate, week.page - 1)}>{t.previous}</Link> : <span />}
            <span>{week.page} {t.of} {week.totalPages}</span>
            {week.page < week.totalPages ? <Link scroll={false} href={dashboardHref(week.selectedDate, week.page + 1)}>{t.nextPage}</Link> : <span />}
          </nav>}
        </section>
      </div>
      <div className="overview-secondary">
        <aside className="overview-tip"><div className="overview-calendar-art" aria-hidden="true"><div className="overview-mini-calendar"><span /><div>{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div></div><i className="overview-art-spark" /></div><div><h2>{t.linkTip}</h2><p>{t.linkTipHint}</p></div></aside>
        <section className="overview-pages" aria-labelledby="my-pages"><div className="overview-section-heading"><h2 id="my-pages">{t.myPages}</h2><Link href="/dashboard/pages" className="workspace-text-link">{t.allPages}<WorkspaceIcon name="chevron" /></Link></div>
          {published.length ? <div className="overview-page-list">{published.slice(0, 3).map(page => <article key={page.id} className="overview-page-card workspace-surface"><span className="overview-card-icon"><WorkspaceIcon name="calendar" /></span><div className="overview-page-info"><h3><Link href={`/dashboard/pages/${page.id}`} title={t.editPage}>{page.title}</Link></h3><p><i aria-hidden="true" />{page.durationMinutes} {t.minutesShort}<span> · {t.publishedLabel}</span></p></div><Link href={`/book/${page.publicId}`} target="_blank" rel="noopener noreferrer" className="workspace-icon-button" aria-label={`${t.openPage}: ${page.title} (новая вкладка)`}><WorkspaceIcon name="external" /></Link></article>)}</div>
            : <div className="overview-empty overview-pages-empty"><h3>{t.noPublished}</h3><p>{t.noPublishedHint}</p><Link href={progress.page ? progress.pageHref : "/dashboard/pages/new"} className="workspace-text-link">{progress.page ? t.publishAction : t.pageAction}<WorkspaceIcon name="chevron" /></Link></div>}
        </section>
      </div>
    </div>
    <div className="overview-bottom"><p>{new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(data.generatedAt)} · {data.timezone}</p><RefreshDashboard /></div>
  </div>;
}
