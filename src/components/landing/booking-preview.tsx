"use client";

import { useEffect, useRef, useState } from "react";
import { landing } from "@/i18n/messages/ru/landing";
import { Icon } from "./icon";
import { useBookingDemo } from "./booking-demo";
import { usePreviewTilt } from "./use-preview-tilt";

const t = landing.preview;
// Fixed, illustrative dates keep the demo independent of real availability and hydration time.
const calendar = { days: 30, offset: 6 };
const month = 0;
const scenarios = [{ day: 18, time: "10:30" }, { day: 18, time: "15:00" }, { day: 23, time: "15:00" }, { day: 25, time: "11:00" }];
function pause(ms: number, signal: AbortSignal) {
  return new Promise<boolean>(resolve => {
    if (signal.aborted) { resolve(false); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); resolve(!signal.aborted); };
    const cancel = () => finish();
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
export function BookingPreview() {
  const { replay, start } = useBookingDemo();
  const [day, setDay] = useState(16);
  const [time, setTime] = useState<string>("14:00");
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState({ day: 16, time: "14:00" });
  const [running, setRunning] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false, pressed: false });
  const card = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const days = useRef(new Map<number, HTMLSpanElement>());
  const slots = useRef(new Map<string, HTMLSpanElement>());
  const confirmTarget = useRef<HTMLDivElement>(null);
  usePreviewTilt(wrapper, card);
  function activateDemo() {
    if (running) return;
    setRunning(true);
    start();
  }
  useEffect(() => {
    if (replay === 0) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const scenario = scenarios[(replay - 1) % scenarios.length]!;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let layoutWidth = 0;
    async function run() {
      // Start after React commits. Replays cancel every pending step of the previous run.
      if (!await pause(0, signal)) return;
      setRunning(true); setConfirmed(false); setDay(16); setTime("14:00");
      setCursor({ x: 35, y: 35, visible: false, pressed: false });
      const rect = wrapper.current?.getBoundingClientRect();
      layoutWidth = wrapper.current?.offsetWidth ?? 0;
      if (rect && (rect.top < 0 || rect.bottom > innerHeight)) wrapper.current?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
      if (reducedMotion) {
        setDay(scenario.day); setTime(scenario.time); setReceipt(scenario); setConfirmed(true); setRunning(false);
        return;
      }
      if (!await pause(700, signal)) return;
      setCursor({ x: 35, y: 35, visible: true, pressed: false });
      async function pointTo(element: HTMLElement | null | undefined, select: () => void) {
        if (!element || !card.current || signal.aborted) return false;
        // Cursor and targets share the card's transform. Layout coordinates keep
        // them aligned while the visitor tilts the card during playback.
        let x = element.offsetWidth / 2;
        let y = element.offsetHeight / 2;
        let parent: HTMLElement | null = element;
        while (parent && parent !== card.current) {
          x += parent.offsetLeft; y += parent.offsetTop;
          parent = parent.offsetParent as HTMLElement | null;
        }
        if (parent !== card.current) return false;
        setCursor({ x, y, visible: true, pressed: false });
        if (!await pause(750, signal)) return false;
        setCursor(value => ({ ...value, pressed: true }));
        if (!await pause(150, signal)) return false;
        select(); setCursor(value => ({ ...value, pressed: false }));
        return pause(370, signal);
      }
      if (!await pointTo(days.current.get(scenario.day), () => setDay(scenario.day))) return;
      if (!await pointTo(slots.current.get(scenario.time), () => setTime(scenario.time))) return;
      if (!await pointTo(confirmTarget.current, () => { setReceipt(scenario); setConfirmed(true); })) return;
      setCursor(value => ({ ...value, visible: false }));
      setRunning(false);
    }
    void run();
    // Only width changes reflow targets; browser chrome can change viewport
    // height during scrolling without moving anything inside the card.
    const cancel = () => { controller.abort(); setRunning(false); setCursor(value => ({ ...value, visible: false, pressed: false })); };
    const resized = () => { if (layoutWidth && wrapper.current?.offsetWidth !== layoutWidth) cancel(); };
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    window.addEventListener("resize", resized);
    motion.addEventListener("change", cancel);
    return () => { controller.abort(); window.removeEventListener("resize", resized); motion.removeEventListener("change", cancel); };
  }, [replay]);
  const selectedCell = calendar.offset + day - 1;
  return <div ref={wrapper} className="landing-preview-wrap" id="demo" aria-label={t.calendarLabel}>
    <div ref={card} className="landing-booking-preview" data-running={running} role="button" tabIndex={0} aria-label={t.startDemo} aria-disabled={running} onClick={activateDemo} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateDemo(); } }}>
      <span className="landing-demo-cursor" aria-hidden="true" data-visible={cursor.visible} data-pressed={cursor.pressed} style={{ left: cursor.x, top: cursor.y }}><svg viewBox="0 0 28 34"><path d="M3 2 4 26l6-6 5 11 5-2-5-10 9-1L3 2Z" fill="var(--color-ink)" stroke="var(--color-paper)" strokeWidth="2" strokeLinejoin="round" /></svg><i /></span>
      <div className="landing-preview-profile">
        <div className="landing-host"><span className="landing-avatar">{t.initials}</span><div><p>{t.name}</p><span>{t.role}</span></div></div>
        <h2>{t.title}</h2>
        <div className="landing-meeting-meta"><span><Icon name="clock" />{t.duration}</span><span><Icon name="video" />{t.location}</span></div>
        <p className="landing-preview-description">{t.description}</p>
        <div className="landing-day-art" aria-hidden="true"><span className="landing-art-label">ВАШ РИТМ</span><div className="landing-art-line"><span>09:00</span><i /><b /></div><div className="landing-art-line"><span>10:00</span><i /><b /></div><div className="landing-art-line"><span>11:00</span><i /><b /></div><span className="landing-art-caption">Место для важного.</span></div>
        <p className="landing-preview-timezone"><Icon name="globe" />{t.timezone}</p>
      </div>
      <div className="landing-preview-calendar">
        <div className="landing-month-header"><p>{t.months[month]}</p><div aria-hidden="true"><span><Icon name="chevron" className="landing-chevron-back" /></span><span><Icon name="chevron" /></span></div></div>
        <div className="landing-calendar-week" aria-hidden="true">{t.weekdays.map(d => <span key={d}>{d}</span>)}</div>
        <div className="landing-calendar-days" aria-hidden="true">
          <i className="landing-calendar-selection" style={{ left: `calc(${selectedCell % 7} * (100% / 7) + (100% / 7 - var(--calendar-day-width)) / 2)`, top: `calc(${Math.floor(selectedCell / 7)} * (var(--calendar-day-height) + var(--calendar-row-gap)))` }} />
          {Array.from({ length: calendar.offset }, (_, i) => <span key={`empty-${i}`} />)}
          {Array.from({ length: calendar.days }, (_, i) => { const date = i + 1; const weekday = (calendar.offset + i) % 7; const available = date >= 16 && date <= 27 && weekday < 5; return <span key={date} ref={element => { if (element) days.current.set(date, element); else days.current.delete(date); }} data-day={date} data-available={available} data-selected={day === date}>{date}</span>; })}
        </div>
        <div className="landing-demo-result" data-confirmed={confirmed}>
          <div className="landing-demo-controls" aria-hidden={confirmed}>
            <p className="landing-slots-label">{t.availability}<span>{day} {t.monthCases[month]}</span></p>
            <div className="landing-time-slots">{t.slots.map(slot => <span key={slot} ref={element => { if (element) slots.current.set(slot, element); else slots.current.delete(slot); }} data-selected={time === slot}>{slot}</span>)}</div>
            <div ref={confirmTarget} className="landing-demo-confirm"><span>{t.confirm} {time}</span><Icon name="arrow" /></div>
          </div>
          <div className="landing-demo-success" aria-hidden={!confirmed}>
            <span className="landing-success-icon"><Icon name="check" /></span><h3>{t.successTitle}</h3>
            <p className="landing-demo-selected">{receipt.day} {t.monthCases[month]} · {receipt.time}</p><p>{t.successText}</p>
          </div>
        </div>
      </div>
    </div>
    <p className="sr-only" role="status">{confirmed ? `${t.successTitle} ${receipt.day} ${t.monthCases[month]} · ${receipt.time}` : running ? t.playing : ""}</p>
  </div>;
}
