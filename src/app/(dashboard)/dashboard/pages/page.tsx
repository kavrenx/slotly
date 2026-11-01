import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/ui/form";
import { listPages } from "@/modules/booking-pages/service";
import { StateBadge } from "@/modules/booking-pages/components/state-badge";
import { requireOrganizer } from "@/modules/organizers/server";
import { getDatabase } from "@/server/db/client";
import { getServerEnv } from "@/server/config/env";
import { CopyPublicLink } from "@/modules/booking-pages/components/copy-public-link";

export default async function PagesPage() {
  const owner = await requireOrganizer();
  const pages = await listPages(getDatabase(), owner.id);
  const appUrl = getServerEnv().APP_URL;
  const active = pages.filter((p) => p.state !== "archived");
  const archived = pages.filter((p) => p.state === "archived");
  const cards = (items: typeof pages) => <div className="mt-6 grid gap-4 lg:grid-cols-2">{items.map((page) => <article key={page.id} className="flex min-w-0 flex-col rounded-2xl border border-line p-6 transition-colors hover:border-accent/40"><div className="flex items-center justify-between gap-4"><span className="text-xs text-muted">Персональная запись</span><StateBadge state={page.state} /></div><h2 className="mt-5 text-xl font-medium wrap-break-word"><Link href={`/dashboard/pages/${page.id}`} className="hover:text-accent">{page.title}</Link></h2><p className="mt-3 line-clamp-2 text-sm leading-6 wrap-break-word text-muted">{page.description || "Без описания"}</p><p className="mt-5 text-xs font-medium text-muted">{page.durationMinutes} мин · Шаг {page.stepMinutes} мин</p><div className="mt-auto flex flex-wrap items-center gap-3 pt-6"><Link href={`/dashboard/pages/${page.id}`} className={secondaryButton}>{page.state === "archived" ? "Посмотреть" : "Настроить"}</Link>{page.state === "published" && <><CopyPublicLink href={`${appUrl}/book/${page.publicId}`} /><Link href={`/book/${page.publicId}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent">Открыть <span aria-hidden="true">↗</span></Link></>}</div></article>)}</div>;
  return <div className="workspace-page"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-semibold tracking-widest text-accent uppercase">Ваши форматы встреч</p><h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Страницы записи</h1></div><Link href="/dashboard/pages/new" className={primaryButton}>+ Создать страницу</Link></div><p className="mt-4 max-w-2xl text-sm leading-7 text-muted">Разные встречи — разные страницы. У каждой свои условия, а расписание у всех общее.</p>
    {active.length ? cards(active) : <section className="mt-8 rounded-3xl border border-dashed border-line bg-panel/50 p-8 text-center sm:p-14"><span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent/10 text-2xl text-accent">+</span><h2 className="mt-5 text-xl font-medium">Место для вашей первой встречи</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-muted">Добавьте название, выберите длительность и сохраните страницу. Начать можно с черновика.</p><Link href="/dashboard/pages/new" className={primaryButton + " mt-6"}>Создать страницу</Link></section>}
    {archived.length > 0 && <details className="mt-9 border-t border-line pt-6"><summary className="cursor-pointer text-sm font-medium text-muted">Архив · {archived.length}</summary>{cards(archived)}</details>}
  </div>;
}
