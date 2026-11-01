import Link from "next/link";
import { primaryButton } from "@/components/ui/form";
import { requireOrganizer } from "@/modules/organizers/server";
import { getDatabase } from "@/server/db/client";
import { getServerEnv } from "@/server/config/env";
import { getSchedule } from "@/modules/availability/service";
import { PageEditor } from "@/modules/booking-pages/components/page-editor";

export default async function NewPage() {
  const owner = await requireOrganizer();
  const schedule = await getSchedule(getDatabase(), owner.id);
  return <><Link href="/dashboard/pages" className="text-xs font-medium text-muted hover:text-accent">← Все страницы</Link><h1 className="mt-5 text-3xl font-medium tracking-tight">Новая страница</h1><p className="mt-4 text-sm leading-7 text-muted">Создайте отдельный формат встречи. После сохранения вы сможете опубликовать его.</p>
    {schedule ? <PageEditor initial={null} timezone={schedule.timezone} appUrl={getServerEnv().APP_URL} /> : <section className="mt-8 max-w-xl rounded-2xl border border-line bg-panel p-7"><h2 className="text-xl font-medium">Сначала выберите удобные часы</h2><p className="mt-3 text-sm leading-7 text-muted">Страницы используют одно общее расписание. Сохраните его, чтобы начать создавать встречи.</p><Link href="/dashboard/schedule" className={primaryButton + " mt-5"}>Настроить расписание</Link></section>}
  </>;
}
