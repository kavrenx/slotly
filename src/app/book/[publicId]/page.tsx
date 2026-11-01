import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/ui/brand-mark";
import { getPublicPage } from "@/modules/booking-pages/service";
import { getDatabase } from "@/server/db/client";
import { DomainError } from "@/shared/domain-error";
import { SlotPicker } from "@/modules/availability/components/slot-picker";

export const dynamic = "force-dynamic";
export default async function PublicBookingPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  let page;
  try { page = await getPublicPage(getDatabase(), publicId); }
  catch (error) { if (error instanceof DomainError && error.status === 404) notFound(); throw error; }
  return <div className="mx-auto flex min-h-svh max-w-6xl flex-col px-4 sm:px-8"><header className="py-7 sm:py-9"><Link href="/" className="inline-flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-accent"><BrandMark />Slotly</Link></header>
    <main className="flex flex-1 items-start py-5 sm:py-8"><div className="grid w-full min-w-0 rounded-3xl border border-line lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
      <article className="min-w-0 border-b border-line p-6 sm:p-8 lg:border-r lg:border-b-0"><div aria-hidden="true" className="grid size-11 place-items-center rounded-2xl bg-accent/10 text-lg font-semibold text-accent">{page.organizerName.slice(0, 1).toUpperCase()}</div><p className="mt-5 text-sm font-medium wrap-break-word text-accent">{page.organizerName}</p><h1 className="mt-4 text-3xl leading-tight font-medium tracking-tight wrap-break-word">{page.title}</h1><div className="mt-6 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-panel px-3 py-2">{page.durationMinutes} минут</span><span className="rounded-full bg-panel px-3 py-2">Персональная встреча</span></div>{page.description && <p className="mt-6 text-sm leading-7 whitespace-pre-wrap wrap-break-word text-muted">{page.description}</p>}{page.location && <section className="mt-6 border-t border-line pt-5"><h2 className="text-xs font-medium text-muted">Место или способ связи</h2><p className="mt-2 text-sm leading-7 whitespace-pre-wrap wrap-break-word">{page.location}</p></section>}<p className="mt-6 border-t border-line pt-5 text-xs leading-6 text-muted">Часовой пояс организатора<br /><span className="font-medium text-ink">{page.timezone}</span></p></article>
      <SlotPicker publicId={publicId} organizerTimezone={page.timezone} serverNow={new Date().toISOString()} timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]} />
    </div></main><footer className="mt-8 border-t border-line py-6 text-xs text-muted">Slotly · Your time. Your rules.</footer></div>;
}
