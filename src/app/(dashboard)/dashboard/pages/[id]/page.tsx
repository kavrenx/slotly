import Link from "next/link";
import { notFound } from "next/navigation";
import { getPage } from "@/modules/booking-pages/service";
import { PageEditor } from "@/modules/booking-pages/components/page-editor";
import { getSchedule } from "@/modules/availability/service";
import { requireOrganizer } from "@/modules/organizers/server";
import { getDatabase } from "@/server/db/client";
import { getServerEnv } from "@/server/config/env";
import { DomainError } from "@/shared/domain-error";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOrganizer();
  const { id } = await params;
  let page;
  try { page = await getPage(getDatabase(), owner.id, id); }
  catch (error) { if (error instanceof DomainError && error.status === 404) notFound(); throw error; }
  const schedule = await getSchedule(getDatabase(), owner.id);
  return <><Link href="/dashboard/pages" className="text-xs font-medium text-muted hover:text-accent">← Все страницы</Link><h1 className="mt-5 text-3xl font-medium tracking-tight">{page.state === "archived" ? "Архивная страница" : "Настройки страницы"}</h1><p className="mt-4 text-sm leading-7 text-muted">Содержание, длительность и правила для этого формата встречи.</p><PageEditor key={page.id} initial={page} timezone={schedule?.timezone ?? "UTC"} appUrl={getServerEnv().APP_URL} /></>;
}
