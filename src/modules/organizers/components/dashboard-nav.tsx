"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { planning } from "@/i18n/messages/ru/planning";

const links = [{ href: "/dashboard", label: planning.nav.home, glyph: "overview" },
  { href: "/dashboard/bookings", label: planning.nav.bookings, glyph: "schedule" },
  { href: "/dashboard/pages", label: planning.nav.pages, glyph: "pages" }, { href: "/dashboard/schedule", label: planning.nav.schedule, glyph: "schedule" }];
export function DashboardNav() {
  const pathname = usePathname();
  return <nav aria-label="Личный кабинет" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
    {links.map((link) => {
      const active = link.href === "/dashboard" ? pathname === link.href : pathname.startsWith(link.href);
      return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}
        className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${active ? "bg-accent text-white" : "text-muted hover:bg-panel hover:text-ink"}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="hidden size-5 md:block" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {link.glyph === "overview" ? <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>
            : link.glyph === "pages" ? <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8h6M9 12h6M9 16h3" /></>
              : <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18M8 15h2m4 0h2" /></>}
        </svg>{link.label}
      </Link>;
    })}
  </nav>;
}
