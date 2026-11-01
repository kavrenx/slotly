import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/ui/form";
import { listPages } from "@/modules/booking-pages/service";
import { StateBadge } from "@/modules/booking-pages/components/state-badge";
import { requireOrganizer } from "@/modules/organizers/server";
import { getDatabase } from "@/server/db/client";
import { getServerEnv } from "@/server/config/env";
import { CopyPublicLink } from "@/modules/booking-pages/components/copy-public-link";
import styles from "@/modules/booking-pages/components/pages.module.css";
import { minuteLabel } from "@/modules/booking-pages/time-units";

export default async function PagesPage() {
  const owner = await requireOrganizer();
  const pages = await listPages(getDatabase(), owner.id);
  const appUrl = getServerEnv().APP_URL;
  const active = pages.filter((p) => p.state !== "archived");
  const archived = pages.filter((p) => p.state === "archived");
  const stateContext = { published: "Принимает записи по ссылке", draft: "Пока видна только вам", paused: "Новые записи приостановлены", archived: "Сохранена для просмотра" };
  const cards = (items: typeof pages) => <div className={styles.cards}>{items.map((page) => <article key={page.id} data-state={page.state} className={styles.card}><div className={styles.cardTop}><span className={styles.cardKind}>Персональная запись</span><StateBadge state={page.state} /></div><h2><Link href={`/dashboard/pages/${page.id}`}>{page.title}</Link></h2>{page.description && <p className={styles.cardDescription}>{page.description}</p>}<p className={styles.cardDuration}><strong>{minuteLabel(page.durationMinutes)}</strong><span>Шаг {page.stepMinutes} мин</span></p><p className={styles.cardState}>{stateContext[page.state]}</p><div className={styles.cardActions}><Link href={`/dashboard/pages/${page.id}`} className={secondaryButton}>{page.state === "archived" ? "Посмотреть" : "Настроить"}</Link>{page.state === "published" && <><CopyPublicLink href={`${appUrl}/book/${page.publicId}`} /><Link href={`/book/${page.publicId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium">Открыть <span aria-hidden="true">↗</span></Link></>}</div></article>)}</div>;
  return <div className="workspace-page"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-semibold tracking-widest text-accent uppercase">Ваши форматы встреч</p><h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Страницы записи</h1></div><Link href="/dashboard/pages/new" className={primaryButton}>+ Создать страницу</Link></div><p className="mt-4 max-w-2xl text-sm leading-7 text-muted">Разные встречи — разные страницы. У каждой свои условия, а расписание у всех общее.</p>
    {active.length ? cards(active) : <section className="mt-8 rounded-3xl border border-dashed border-line bg-panel/50 p-8 text-center sm:p-14"><span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent/10 text-2xl text-accent">+</span><h2 className="mt-5 text-xl font-medium">Место для вашей первой встречи</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-muted">Добавьте название, выберите длительность и сохраните страницу. Начать можно с черновика.</p><Link href="/dashboard/pages/new" className={primaryButton + " mt-6"}>Создать страницу</Link></section>}
    {archived.length > 0 && <details className="mt-9 border-t border-line pt-6"><summary className="cursor-pointer text-sm font-medium text-muted">Архив · {archived.length}</summary>{cards(archived)}</details>}
  </div>;
}
