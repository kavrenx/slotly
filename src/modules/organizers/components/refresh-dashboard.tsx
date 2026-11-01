"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { secondaryButton } from "@/components/ui/form";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";

export function RefreshDashboard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" disabled={pending} aria-busy={pending} className={secondaryButton} onClick={() => startTransition(() => router.refresh())}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`size-4 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.5-1.5L20 8M4 16l2.4 2.5A7 7 0 0 0 17.9 17" /></svg>
    {pending ? t.refreshing : t.refresh}
  </button>;
}
