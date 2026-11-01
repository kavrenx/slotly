"use client";
import { useState } from "react";
import { secondaryButton, fieldClass } from "@/components/ui/form";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";

export function CopyPublicLink({ href }: { href: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  return <div className="min-w-0">
    <button type="button" className={secondaryButton} onClick={async () => {
      try { await navigator.clipboard.writeText(href); setStatus("copied"); }
      catch { setStatus("manual"); }
    }}>{status === "copied" ? t.copied : t.copy}</button>
    <span role="status" className="sr-only">{status === "copied" ? t.copied : status === "manual" ? t.copyFailed : ""}</span>
    {status === "manual" && <label className="mt-3 block text-xs leading-6 text-muted">{t.copyFailed}<input readOnly aria-label={t.publicLink} className={fieldClass + " mt-2"} value={href} onFocus={event => event.currentTarget.select()} /></label>}
  </div>;
}
