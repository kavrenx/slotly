"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClass, FormNotice, primaryButton, secondaryButton } from "@/components/ui/form";
import { planning } from "@/i18n/messages/ru/planning";
import { planningRequest } from "@/modules/organizers/planning-client";
import { minuteToTime, scheduleInput, timeToMinute, type ScheduleData } from "../validation";

type ClockWindow = { start: string; end: string };
type Override = { key: number; localDate: string; mode: "closed" | "replace"; windows: ClockWindow[] };
const defaultWindow = () => ({ start: "09:00", end: "17:00" });
const toClock = (w: { startMinute: number; endMinute: number }) => ({ start: minuteToTime(w.startMinute), end: minuteToTime(w.endMinute) });
const toMinutes = (w: ClockWindow) => ({ startMinute: timeToMinute(w.start), endMinute: timeToMinute(w.end) });

function WindowsEditor({ id, label, windows, onChange }: { id: string; label: string; windows: ClockWindow[]; onChange: (windows: ClockWindow[]) => void }) {
  return <div className="space-y-2">
    {windows.map((window, index) => <div key={index} className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`${id}-${index}-start`}>{label}, начало интервала {index + 1}</label>
      <input id={`${id}-${index}-start`} aria-label={`${label}, начало интервала ${index + 1}`} className={fieldClass + " max-w-24 px-3 py-2.5 tabular-nums"} value={window.start} placeholder="09:00" inputMode="numeric" maxLength={5} pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" required onChange={(event) => onChange(windows.map((w, i) => i === index ? { ...w, start: event.target.value } : w))} />
      <span aria-hidden="true" className="text-muted">—</span>
      <label className="sr-only" htmlFor={`${id}-${index}-end`}>{label}, конец интервала {index + 1}</label>
      <input id={`${id}-${index}-end`} aria-label={`${label}, конец интервала ${index + 1}`} className={fieldClass + " max-w-24 px-3 py-2.5 tabular-nums"} value={window.end} placeholder="17:00" inputMode="numeric" maxLength={5} pattern="(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)" required onChange={(event) => onChange(windows.map((w, i) => i === index ? { ...w, end: event.target.value } : w))} />
      <button type="button" className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-panel hover:text-rose-700" aria-label={`${label}, удалить интервал ${index + 1}`} onClick={() => onChange(windows.filter((_, i) => i !== index))}>×</button>
    </div>)}
    {windows.length < 8 && <button type="button" className="min-h-9 text-xs font-medium text-accent underline-offset-4 hover:underline" onClick={() => {
      const last = timeToMinute(windows.at(-1)?.end ?? "09:00") ?? 540;
      onChange([...windows, { start: minuteToTime(last < 1440 ? last : 540), end: minuteToTime(last < 1440 ? Math.min(last + 60, 1440) : 600) }]);
    }}>+ Добавить интервал</button>}
  </div>;
}

export function ScheduleForm({ initial, timezones }: { initial: ScheduleData | null; timezones: string[] }) {
  const router = useRouter();
  const [version, setVersion] = useState(initial?.version ?? 0);
  const [timezone, setTimezone] = useState(initial?.timezone ?? "UTC");
  const [weekly, setWeekly] = useState<ClockWindow[][]>(() => Array.from({ length: 7 }, (_, index) => initial ? initial.weekly.filter((w) => w.weekday === index + 1).map(toClock) : index < 5 ? [defaultWindow()] : []));
  const [overrides, setOverrides] = useState<Override[]>(() => initial?.overrides.map((o, i) => ({ ...o, key: i, windows: o.windows.map(toClock) })) ?? []);
  const [nextKey, setNextKey] = useState(initial?.overrides.length ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  function dirty() { setSuccess(""); setError(""); }
  function updateOverride(key: number, patch: Partial<Override>) { dirty(); setOverrides((all) => all.map((o) => o.key === key ? { ...o, ...patch } : o)); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(""); setSuccess("");
    const payload = { version, timezone, weekly: weekly.flatMap((windows, day) => windows.map((w) => ({ weekday: day + 1, ...toMinutes(w) }))),
      overrides: overrides.map((o) => ({ localDate: o.localDate, mode: o.mode, windows: o.windows.map(toMinutes) })) };
    const result = scheduleInput.safeParse(payload);
    if (!result.success) { setError("Проверьте расписание: начало должно быть раньше конца, интервалы не должны пересекаться. Даты исключений не должны повторяться. Для особого рабочего дня нужен хотя бы один интервал."); return; }
    setPending(true);
    try {
      const saved = await planningRequest<ScheduleData>("/api/organizer/schedule", "PUT", result.data);
      setVersion(saved.version); setSuccess("Расписание сохранено для всех ваших страниц."); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : planning.errors.SERVICE_UNAVAILABLE ?? "Попробуйте ещё раз."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="mt-8 max-w-3xl space-y-6" aria-busy={pending}>
    <fieldset disabled={pending} className="min-w-0 space-y-6">
      <section className="rounded-2xl border border-line p-5 sm:p-7">
        <h2 className="text-lg font-medium">Часовой пояс</h2><p className="mt-2 text-sm leading-6 text-muted">Все часы и исключения ниже заданы в этом поясе. Сезонные переводы часов будут учитываться по выбранной зоне.</p>
        <label className="mt-5 block max-w-md text-sm font-medium" htmlFor="schedule-timezone">Ваш часовой пояс</label>
        <div className="mt-2 flex flex-wrap items-center gap-3"><select id="schedule-timezone" className={fieldClass + " max-w-md"} value={timezone} onChange={(event) => { dirty(); setTimezone(event.target.value); }}>
          {[...new Set([timezone, ...timezones])].map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
        </select><button type="button" className="min-h-10 text-xs font-medium text-accent underline underline-offset-4" onClick={() => {
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (zone) { dirty(); setTimezone(zone); }
        }}>Определить мой пояс</button></div>
        {initial && timezone !== initial.timezone && <p className="mt-4 rounded-xl bg-panel p-3 text-xs leading-6 text-muted">Часы и особые даты останутся прежними, но будут относиться к новому поясу. Уже назначенные встречи сохраняют своё время.</p>}
      </section>
      <section className="rounded-2xl border border-line p-5 sm:p-7">
        <h2 className="text-lg font-medium">Обычная неделя</h2><p className="mt-2 text-sm leading-6 text-muted">Отметьте дни и часы, когда готовы встречаться. Перерыв задаётся двумя отдельными интервалами.</p>
        <div className="mt-6 divide-y divide-line">
          {weekly.map((windows, day) => <div key={day} className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
            <label className="flex min-h-10 min-w-44 items-center gap-3 text-sm font-medium"><input type="checkbox" className="size-4 accent-accent" checked={windows.length > 0} onChange={(event) => { dirty(); setWeekly((week) => week.map((w, index) => index === day ? event.target.checked ? [defaultWindow()] : [] : w)); }} />{planning.weekdays[day]}</label>
            {windows.length ? <WindowsEditor id={`weekday-${day}`} label={planning.weekdays[day] ?? "День"} windows={windows} onChange={(next) => { dirty(); setWeekly((week) => week.map((w, index) => index === day ? next : w)); }} /> : <p className="py-2.5 text-sm text-muted">Выходной</p>}
          </div>)}
        </div>
        <p className="mt-4 text-xs leading-6 text-muted">Формат — ЧЧ:ММ. Для конца дня можно указать 24:00. Интервал через полночь разделите между двумя днями.</p>
      </section>
      <section className="rounded-2xl border border-line p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-medium">Особые даты</h2><span className="text-xs text-muted">{overrides.length ? `Исключений: ${overrides.length}` : "Не добавлены"}</span></div>
        <p className="mt-2 text-sm leading-6 text-muted">Выходной, отпуск или другой график на конкретную дату. Исключение полностью заменяет обычный день недели.</p>
        <div className="mt-5 space-y-4">
          {overrides.map((override, index) => <div key={override.key} className="rounded-xl bg-panel p-4">
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className="text-xs font-medium">Дата {index + 1}<input type="date" required className={fieldClass + " mt-2"} value={override.localDate} onChange={(event) => updateOverride(override.key, { localDate: event.target.value })} /></label>
              <label className="text-xs font-medium">Режим даты {index + 1}<select className={fieldClass + " mt-2"} value={override.mode} onChange={(event) => { const mode = event.target.value as Override["mode"]; updateOverride(override.key, { mode, windows: mode === "replace" ? [defaultWindow()] : [] }); }}><option value="closed">Выходной</option><option value="replace">Другое время</option></select></label>
              <button type="button" className="min-h-11 rounded-lg px-3 text-sm text-rose-800 hover:bg-paper" aria-label={`Удалить исключение ${index + 1}`} onClick={() => { dirty(); setOverrides((all) => all.filter((o) => o.key !== override.key)); }}>Удалить</button>
            </div>
            {override.mode === "replace" && <div className="mt-4"><WindowsEditor id={`override-${override.key}`} label={`Исключение ${index + 1}`} windows={override.windows} onChange={(windows) => updateOverride(override.key, { windows })} /></div>}
          </div>)}
        </div>
        {overrides.length < 366 && <button type="button" className={secondaryButton + " mt-5"} onClick={() => { dirty(); setOverrides((all) => [...all, { key: nextKey, localDate: "", mode: "closed", windows: [] }]); setNextKey((key) => key + 1); }}>+ Добавить дату</button>}
      </section>
    </fieldset>
    <FormNotice error={error} success={success} />
    <div className="flex flex-wrap items-center gap-4 pb-6"><button disabled={pending} className={primaryButton}>{pending ? "Сохраняем…" : "Сохранить расписание"}</button><p className="text-xs text-muted">Применится ко всем страницам записи.</p></div>
  </form>;
}
