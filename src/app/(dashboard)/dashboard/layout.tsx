import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { SignOut } from "@/modules/identity/components/sign-out";
import { DashboardNav } from "@/modules/organizers/components/dashboard-nav";
import { requireOrganizer } from "@/modules/organizers/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const organizer = await requireOrganizer();
  return <div className="mx-auto min-h-svh max-w-[1440px] px-4 sm:px-8 lg:px-12">
    <a className="skip-link" href="#dashboard-main">Перейти к содержимому</a>
    <header className="flex min-h-24 items-center justify-between gap-4 border-b border-line py-5">
      <Link href="/dashboard" className="inline-flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-accent"><BrandMark />Slotly</Link>
      <div className="flex items-center gap-4"><span className="hidden max-w-64 truncate text-sm text-muted sm:block">{organizer.displayName}</span><SignOut /></div>
    </header>
    <div className="grid md:grid-cols-[210px_minmax(0,1fr)] lg:gap-10">
      <aside className="min-w-0 border-b border-line py-4 md:min-h-[calc(100svh-96px)] md:border-r md:border-b-0 md:py-8 md:pr-6">
        <p className="mb-4 hidden px-4 text-[11px] font-semibold tracking-widest text-muted uppercase md:block">Ваше пространство</p>
        <DashboardNav />
        <p className="mt-16 hidden px-4 text-xs leading-6 text-muted md:block">Ваше время.<br />Ваши правила.</p>
      </aside>
      <main id="dashboard-main" className="min-w-0 py-8 md:pl-8 lg:py-10 lg:pl-0">{children}</main>
    </div>
  </div>;
}
