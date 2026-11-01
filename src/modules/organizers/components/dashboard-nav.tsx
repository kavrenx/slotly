"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { planning } from "@/i18n/messages/ru/planning";
import { WorkspaceIcon } from "./workspace-icon";

const links = [{ href: "/dashboard", label: planning.nav.home, glyph: "overview" },
  { href: "/dashboard/bookings", label: planning.nav.bookings, glyph: "calendar" },
  { href: "/dashboard/pages", label: planning.nav.pages, glyph: "pages" }, { href: "/dashboard/schedule", label: planning.nav.schedule, glyph: "calendar" }] as const;
export function DashboardNav() {
  const pathname = usePathname();
  return <nav aria-label="Личный кабинет" className="workspace-nav">
    {links.map((link) => {
      const active = link.href === "/dashboard" ? pathname === link.href : pathname.startsWith(link.href);
      return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}
        className="workspace-nav-link">
        <WorkspaceIcon name={link.glyph} /><span>{link.label}</span>
      </Link>;
    })}
  </nav>;
}
