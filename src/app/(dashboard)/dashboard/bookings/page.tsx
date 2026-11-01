import Link from "next/link";
import { secondaryButton } from "@/components/ui/form";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";
import { requireOrganizer } from "@/modules/organizers/server";
import { getBookingList } from "@/modules/organizers/dashboard-service";
import { bookingViews, bookingsHref, readBookingFilters } from "@/modules/organizers/dashboard-contract";
import { MeetingCard } from "@/modules/organizers/components/meeting-card";
import { RefreshDashboard } from "@/modules/organizers/components/refresh-dashboard";
import { getDatabase } from "@/server/db/client";

export default async function BookingsPage({ searchParams }: PageProps<"/dashboard/bookings">) {
  const owner = await requireOrganizer();
  const result = await getBookingList(getDatabase(), owner.id, readBookingFilters(await searchParams));
  return <div className="workspace-page">
    <p className="text-xs font-semibold tracking-widest text-accent uppercase">{t.meetingsTitle}</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{t.views[result.view]}</h1><RefreshDashboard /></div>
    <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">{t.meetingsHint}</p>
    <nav aria-label="Разделы записей" className="mt-7 flex flex-wrap gap-2">{bookingViews.map(view => <Link key={view} href={bookingsHref(view)} aria-current={result.view === view ? "page" : undefined}
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors ${result.view === view ? "bg-accent text-white" : "border border-line hover:bg-panel"}`}>
      {t.views[view]}<span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${result.view === view ? "bg-white/15" : "bg-panel text-muted"}`}>{result.counts[view]}</span>
    </Link>)}</nav>
    {result.items.length ? <>
      <p className="mt-6 text-xs text-muted">{t.total}: {result.total}</p>
      <div className="booking-list">{result.items.map(meeting => <MeetingCard key={meeting.id} meeting={meeting} now={result.generatedAt} />)}</div>
      {result.totalPages > 1 && <nav aria-label="Страницы списка записей" className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        {result.page > 1 ? <Link href={bookingsHref(result.view, result.page - 1)} className={secondaryButton}>{t.previous}</Link> : <span />}
        <p className="text-xs text-muted">{t.page} {result.page} {t.of} {result.totalPages}</p>
        {result.page < result.totalPages ? <Link href={bookingsHref(result.view, result.page + 1)} className={secondaryButton}>{t.nextPage}</Link> : <span />}
      </nav>}
    </> : <section className="mt-8 rounded-2xl border border-dashed border-line bg-panel/50 p-7 sm:p-9"><h2 className="text-xl font-medium">{t.empty[result.view]}</h2><p className="mt-3 max-w-xl text-sm leading-7 text-muted">{t.emptyHint[result.view]}</p><Link href="/dashboard/pages" className={secondaryButton + " mt-5"}>{t.emptyPages}</Link></section>}
  </div>;
}
