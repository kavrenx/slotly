"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldClass, FormNotice, primaryButton, secondaryButton } from "@/components/ui/form";
import { planning } from "@/i18n/messages/ru/planning";
import { planningRequest } from "@/modules/organizers/planning-client";
import type { PageData } from "../service";
import { pageDefaults, pageInput, type PageState } from "../validation";
import { StateBadge } from "./state-badge";
import { MinuteRuleField } from "./minute-rule-field";
import { minuteLabel } from "../time-units";
import styles from "./pages.module.css";

const basicNumbers = [
  { key: "durationMinutes", label: "Длительность встречи, мин", min: 5, max: 480, step: 5 },
  { key: "stepMinutes", label: "Шаг начала, мин", min: 5, max: 120, step: 5 },
] as const;
const extraNumbers = [
  { key: "bufferBeforeMinutes", label: "Буфер до встречи, мин", min: 0, max: 240, step: 5 },
  { key: "bufferAfterMinutes", label: "Буфер после встречи, мин", min: 0, max: 240, step: 5 },
  { key: "minNoticeMinutes", label: "Минимальное время до записи, мин", min: 0, max: 43200, step: 1 },
  { key: "horizonDays", label: "Горизонт записи, дней", min: 1, max: 365, step: 1 },
  { key: "cancelCutoffMinutes", label: "Отмена не позднее чем за, мин", min: 0, max: 43200, step: 1 },
  { key: "rescheduleCutoffMinutes", label: "Перенос не позднее чем за, мин", min: 0, max: 43200, step: 1 },
] as const;

export function PageEditor({ initial, timezone, appUrl }: { initial: PageData | null; timezone: string; appUrl: string }) {
  const router = useRouter();
  const [page, setPage] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [stateFeedback, setStateFeedback] = useState({ error: "", success: "" });
  const [archivePrompt, setArchivePrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState(() => {
    const data = initial ?? pageDefaults;
    return { title: data.title, description: data.description, location: data.location,
      ...Object.fromEntries([...basicNumbers, ...extraNumbers].map((field) => [field.key, String(data[field.key])])) } as Record<keyof typeof pageDefaults, string>;
  });
  const archived = page?.state === "archived";
  function update(key: keyof typeof form, value: string) { setForm((old) => ({ ...old, [key]: value })); setDirty(true); setError(""); setSuccess(""); setStateFeedback({ error: "", success: "" }); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || archived) return;
    setError(""); setSuccess(""); setStateFeedback({ error: "", success: "" });
    const payload = { ...form, ...Object.fromEntries([...basicNumbers, ...extraNumbers].map((f) => [f.key, form[f.key] === "" ? null : Number(form[f.key])])) };
    const parsed = pageInput.safeParse(payload);
    if (!parsed.success) { setError("Проверьте название и допустимые значения параметров времени."); return; }
    setPending(true);
    try {
      const saved = await planningRequest<PageData>(page ? `/api/organizer/pages/${page.id}` : "/api/organizer/pages", page ? "PUT" : "POST", page ? { ...parsed.data, version: page.version } : parsed.data);
      setPage(saved); setDirty(false); setSuccess("Изменения сохранены.");
      if (!page) router.replace(`/dashboard/pages/${saved.id}`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : planning.errors.SERVICE_UNAVAILABLE ?? "Попробуйте ещё раз."); }
    finally { setPending(false); }
  }
  async function changeState(state: PageState) {
    if (!page || pending) return;
    if (dirty) { setStateFeedback({ error: "Сначала сохраните изменения страницы.", success: "" }); return; }
    setPending(true); setStateFeedback({ error: "", success: "" });
    try {
      const saved = await planningRequest<PageData>(`/api/organizer/pages/${page.id}/state`, "POST", { state, version: page.version });
      setPage(saved); setArchivePrompt(false); setStateFeedback({ error: "", success: `Состояние изменено: ${planning.states[saved.state].toLowerCase()}.` }); router.refresh();
    } catch (cause) { setStateFeedback({ error: cause instanceof Error ? cause.message : planning.errors.SERVICE_UNAVAILABLE ?? "Попробуйте ещё раз.", success: "" }); }
    finally { setPending(false); }
  }
  const numberField = (field: (typeof basicNumbers)[number] | (typeof extraNumbers)[number]) => {
    if (field.key !== "durationMinutes" && field.key !== "stepMinutes" && field.key !== "horizonDays") return <MinuteRuleField key={field.key} id={field.key} label={field.label.replace(/, мин$/u, "")} value={form[field.key]} max={field.max} step={field.step} allowDays={!field.key.startsWith("buffer")} onChange={value => update(field.key, value)} />;
    return <div key={field.key}><label className="block text-sm font-medium" htmlFor={field.key}>{field.label}<input id={field.key} type="number" inputMode="numeric" required min={field.min} max={field.max} step={field.step} className={fieldClass + " mt-2"} value={form[field.key]} onChange={(event) => update(field.key, event.target.value)} /><span className="mt-1.5 block text-xs font-normal text-muted">От {field.min} до {field.max}{field.step > 1 ? `, шаг ${field.step}` : ""}</span></label>{field.key !== "horizonDays" && <div className={styles.presets} role="group" aria-label={field.key === "durationMinutes" ? "Популярная длительность" : "Популярный шаг начала"}>{(field.key === "durationMinutes" ? [15, 30, 45, 60] : [5, 10, 15, 30]).map(value => <button key={value} type="button" aria-pressed={Number(form[field.key]) === value} onClick={() => update(field.key, String(value))}>{value} мин</button>)}</div>}</div>;
  };
  return <div className={styles.editor + " mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px]"}>
    <form onSubmit={submit} className="min-w-0 space-y-6" aria-busy={pending}>
      <fieldset disabled={pending || archived} className="min-w-0 space-y-6">
        <section className="space-y-5 rounded-2xl border border-line p-5 sm:p-7">
          <h2 className="text-lg font-medium">О встрече</h2>
          <label htmlFor="page-title" className="block text-sm font-medium">Название<input id="page-title" className={fieldClass + " mt-2"} required maxLength={120} value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Например, знакомство или консультация" /></label>
          <label htmlFor="page-description" className="block text-sm font-medium">Описание <span className="font-normal text-muted">· необязательно</span><textarea id="page-description" className={fieldClass + " mt-2 min-h-32 resize-y leading-6"} maxLength={4000} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Что стоит знать участнику перед встречей?" /></label>
          <label htmlFor="page-location" className="block text-sm font-medium">Место или способ связи <span className="font-normal text-muted">· необязательно</span><input id="page-location" className={fieldClass + " mt-2"} maxLength={1000} value={form.location} onChange={(event) => update("location", event.target.value)} placeholder="Онлайн или адрес встречи" /><span className="mt-2 block text-xs font-normal leading-6 text-muted">Этот текст виден всем, у кого есть ссылка на страницу.</span></label>
        </section>
        <section className="rounded-2xl border border-line p-5 sm:p-7"><h2 className="text-lg font-medium">Время встречи</h2><p className="mt-2 text-sm leading-6 text-muted">Длительность — сколько идёт встреча. Шаг — как часто можно начинать новую.</p><div className="mt-5 grid gap-5 sm:grid-cols-2">{basicNumbers.map(numberField)}</div></section>
        <details className="group rounded-2xl border border-line p-5 sm:p-7"><summary className="cursor-pointer text-sm font-medium">Буферы и правила записи</summary><p className="mt-4 text-xs leading-6 text-muted">Выберите удобные единицы. Значение 0 снимает соответствующее ограничение. Смена единиц сохраняет точное число минут.</p><div className="mt-5 grid gap-5 sm:grid-cols-2">{extraNumbers.map(numberField)}</div><p className="mt-5 text-xs leading-6 text-muted">Новые условия относятся к будущим записям. Для уже назначенных встреч сохраняются исходные длительность, буферы и правила изменения.</p></details>
      </fieldset>
      <FormNotice error={error} success={success} />
      {!archived && <div className="flex flex-wrap gap-3 pb-6"><button disabled={pending} className={primaryButton}>{pending ? "Сохраняем…" : page ? "Сохранить изменения" : "Создать черновик"}</button><Link href="/dashboard/pages" className={secondaryButton}>К списку страниц</Link></div>}
    </form>
    <aside className="min-w-0 space-y-5 xl:sticky xl:top-6">
      <FormNotice error={stateFeedback.error} success={stateFeedback.success} />
      <section className="rounded-2xl bg-panel p-5"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-muted">Страница записи</p><StateBadge state={page?.state ?? "draft"} /></div><p className="mt-5 text-xl leading-snug font-medium wrap-break-word">{form.title.trim() || "Ваша новая встреча"}</p><p className="mt-3 text-sm text-muted">{minuteLabel(form.durationMinutes)} · Персональная встреча</p><p className="mt-3 text-xs leading-6 text-muted">Общее расписание<br /><span className="font-medium text-ink">{timezone}</span></p><Link href="/dashboard/schedule" className="mt-4 inline-block text-xs font-medium text-accent underline underline-offset-4">Изменить часы</Link><dl className={styles.previewRules}><div><dt>Шаг начала</dt><dd>{minuteLabel(form.stepMinutes)}</dd></div><div><dt>Запись заранее</dt><dd>{form.minNoticeMinutes === "0" ? "Без ограничения" : `От ${minuteLabel(form.minNoticeMinutes)}`}</dd></div><div><dt>Горизонт</dt><dd>{form.horizonDays || "—"} дн</dd></div><div><dt>Отмена до начала</dt><dd>{minuteLabel(form.cancelCutoffMinutes)}</dd></div><div><dt>Перенос до начала</dt><dd>{minuteLabel(form.rescheduleCutoffMinutes)}</dd></div><div><dt>Буферы до / после</dt><dd>{minuteLabel(form.bufferBeforeMinutes)} / {minuteLabel(form.bufferAfterMinutes)}</dd></div></dl>{dirty && <p className={styles.unsaved}>Изменения ещё не сохранены</p>}</section>
      {page && !archived && <section className="space-y-3 rounded-2xl border border-line p-5">
        <h2 className="text-sm font-medium">Доступ по ссылке</h2>
        <p className="text-xs leading-6 text-muted">{page.state === "published" ? "Страница открыта по вашей постоянной ссылке." : "Пока страница не опубликована, она доступна только вам в кабинете."}</p>
        {page.state === "published" ? <><Link className={secondaryButton + " w-full"} href={`/book/${page.publicId}`} target="_blank" rel="noopener noreferrer">Открыть страницу ↗</Link><button type="button" className={secondaryButton + " w-full"} onClick={async () => {
          try { await navigator.clipboard.writeText(`${appUrl}/book/${page.publicId}`); setCopied(true); } catch { setStateFeedback({ error: "Не удалось скопировать. Откройте страницу и скопируйте адрес из строки браузера.", success: "" }); }
        }}>{copied ? "Ссылка скопирована" : "Скопировать ссылку"}</button><button type="button" disabled={pending} className={secondaryButton + " w-full"} onClick={() => void changeState("paused")}>Приостановить</button></>
          : <button type="button" disabled={pending} className={primaryButton + " w-full"} onClick={() => void changeState("published")}>{page.state === "paused" ? "Возобновить" : "Опубликовать"}</button>}
        <button type="button" disabled={pending} className="min-h-10 w-full text-xs text-muted underline underline-offset-4 hover:text-rose-800" onClick={() => setArchivePrompt(true)}>Перенести в архив</button>
        {archivePrompt && <div className="feedback-message-in rounded-xl bg-panel p-3"><p className="text-xs leading-6">Архивную страницу нельзя вернуть к записи. История встреч сохранится. Продолжить?</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending} className="min-h-10 rounded-lg bg-ink px-3 text-xs text-paper" onClick={() => void changeState("archived")}>Архивировать</button><button type="button" className="min-h-10 px-2 text-xs" onClick={() => setArchivePrompt(false)}>Отмена</button></div></div>}
      </section>}
      {archived && <p className="rounded-xl border border-line p-4 text-xs leading-6 text-muted">Страница в архиве. Её настройки сохранены и доступны для просмотра.</p>}
    </aside>
  </div>;
}
