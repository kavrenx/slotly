import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/ui/brand-mark";
import { getPublicPage } from "@/modules/booking-pages/service";
import { getDatabase } from "@/server/db/client";
import { DomainError } from "@/shared/domain-error";
import { SlotPicker } from "@/modules/availability/components/slot-picker";
import styles from "@/components/booking/public-booking.module.css";

export const dynamic = "force-dynamic";
export default async function PublicBookingPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  let page;
  try { page = await getPublicPage(getDatabase(), publicId); }
  catch (error) { if (error instanceof DomainError && error.status === 404) notFound(); throw error; }
  return <div className="mx-auto flex min-h-svh max-w-6xl flex-col px-4 sm:px-8"><header className="py-7 sm:py-9"><Link href="/" className="inline-flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-accent"><BrandMark />Slotly</Link></header>
    <main className="flex flex-1 items-start py-5 sm:py-8"><div className={styles.shell}>
      <article className={styles.organizer}>
        <div className={styles.organizerIdentity}><div aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent/10 text-lg font-semibold text-accent">{page.organizerName.slice(0, 1).toUpperCase()}</div><p>{page.organizerName}</p></div>
        <h1>{page.title}</h1><div className={styles.badges}><span>{page.durationMinutes} минут</span><span>Персональная встреча</span></div>
        {page.description && <p className={styles.organizerDescription}>{page.description}</p>}
        {page.location && <section className={styles.location}><h2>Место или способ связи</h2><p>{page.location}</p></section>}
        <p className={styles.organizerZone}>Часовой пояс организатора<br /><span>{page.timezone}</span></p>
      </article>
      <SlotPicker publicId={publicId} organizerTimezone={page.timezone} serverNow={new Date().toISOString()} timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]} />
    </div></main><footer className="mt-8 border-t border-line py-6 text-xs text-muted">Slotly · Your time. Your rules.</footer></div>;
}
