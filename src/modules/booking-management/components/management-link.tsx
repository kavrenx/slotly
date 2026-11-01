"use client";
import { useState } from "react";
import { secondaryButton } from "@/components/ui/form";
import { bookingManagement as t } from "@/i18n/messages/ru/booking-management";
import { managementHref } from "../contract";
export function CopyManagementLink({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  return <div><button type="button" className={secondaryButton} onClick={async () => { try { await navigator.clipboard.writeText(new URL(managementHref(token), window.location.origin).href); setMessage(t.copied); } catch { setMessage("Не удалось скопировать ссылку. Откройте личную страницу и сохраните её адрес."); } }}>{t.copy}</button><p role="status" className="mt-2 text-xs text-muted">{message}</p></div>;
}
