"use client";
import { useState } from "react";
import type { BookingReceipt } from "../contract";
import { bookingCalendar } from "../calendar-export";
import { secondaryButton } from "@/components/ui/form";

export function CalendarDownload({ receipt }: { receipt: BookingReceipt }) {
  const [error, setError] = useState("");
  return <div><button type="button" className={secondaryButton + " w-full"} onClick={() => {
    setError("");
    try {
      const blob = new Blob([bookingCalendar(receipt, new Date())], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `slotly-${receipt.id}.ics`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Не удалось подготовить файл календаря. Попробуйте ещё раз."); }
  }}>Добавить в календарь <span className="text-xs font-normal opacity-70">.ics</span></button><p className="mt-2 text-[11px] leading-5 text-muted">Скачивается копия встречи. Изменения в Slotly не обновят её автоматически.</p>{error && <p role="alert" className="feedback-message-in mt-2 text-xs text-rose-800">{error}</p>}</div>;
}
