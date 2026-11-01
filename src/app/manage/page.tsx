import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { GuestManagement } from "@/modules/booking-management/components/management";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Управление встречей — Slotly", robots: { index: false, follow: false } };
export default function ManagePage() {
  return <div className="mx-auto min-h-svh max-w-4xl px-5 py-8 sm:px-10"><a href="#management-main" className="skip-link">Перейти к записи</a><header><Link href="/" className="inline-flex items-center gap-2 text-2xl font-semibold text-accent"><BrandMark />Slotly</Link></header><main id="management-main" className="mt-12 rounded-3xl border border-line bg-paper p-5 sm:p-9"><GuestManagement /></main></div>;
}
