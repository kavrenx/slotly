import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { SectionLink } from "@/components/ui/section-link";
import { SignOut } from "@/modules/identity/components/sign-out";
import { SessionGuard } from "@/modules/identity/components/session-guard";
import { DashboardNav } from "@/modules/organizers/components/dashboard-nav";
import { requireOrganizer } from "@/modules/organizers/server";
import { WorkspaceIcon } from "@/modules/organizers/components/workspace-icon";
import "./workspace.css";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const organizer = await requireOrganizer();
  return <div className="workspace">
    <SectionLink className="skip-link" section="dashboard-main">Перейти к содержимому</SectionLink>
    <header className="workspace-header">
      <Link href="/dashboard" aria-label="Slotly — обзор" className="workspace-brand"><BrandMark />Slotly</Link>
      <div className="workspace-account"><span className="workspace-account-name" title={organizer.displayName}>{organizer.displayName}</span><SignOut /></div>
    </header>
    <div className="workspace-body">
      <aside className="workspace-sidebar">
        <p className="workspace-sidebar-label">Ваше пространство</p>
        <DashboardNav />
        <div className="workspace-note"><WorkspaceIcon name="sprout" /><div><p>Растём вместе с вами</p><span>Больше времени для того, что важно.</span></div></div>
      </aside>
      <main id="dashboard-main" tabIndex={-1} className="workspace-main"><SessionGuard>{children}</SessionGuard></main>
    </div>
  </div>;
}
