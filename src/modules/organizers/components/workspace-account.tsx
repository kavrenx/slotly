"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SignOut } from "@/modules/identity/components/sign-out";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";
import { WorkspaceIcon } from "./workspace-icon";

type Activity = { id: string; bookingId: string; title: string; type: "created" | "rescheduled" | "cancelled"; createdAt: string; timezone: string };
type Feed = { status: "idle" | "loading" } | { status: "ready"; items: Activity[] } | { status: "error" };
export function WorkspaceAccount({ displayName }: { displayName: string }) {
  const router = useRouter();
  const notifications = useRef<HTMLDivElement>(null), account = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false), [accountOpen, setAccountOpen] = useState(false);
  const [feed, setFeed] = useState<Feed>({ status: "idle" });
  useEffect(() => () => request.current?.abort(), []);
  async function loadActivity() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setFeed({ status: "loading" });
    try {
      const response = await fetch("/api/organizer/activity", { cache: "no-store", signal: controller.signal });
      if (response.status === 401) { notifications.current?.hidePopover(); router.replace("/login"); router.refresh(); return; }
      if (!response.ok) throw new Error("ACTIVITY_UNAVAILABLE");
      const result = await response.json() as { items: Activity[] };
      if (!controller.signal.aborted) setFeed({ status: "ready", items: result.items });
    } catch { if (!controller.signal.aborted) setFeed({ status: "error" }); }
  }
  return <div className="workspace-account">
    <button type="button" className="workspace-notifications-button" aria-label={t.notifications} aria-expanded={notificationsOpen} aria-haspopup="dialog" aria-controls="workspace-notifications" popoverTarget="workspace-notifications"><WorkspaceIcon name="bell" /></button>
    <button type="button" className="workspace-account-button" aria-label={`${t.account}: ${displayName}`} aria-expanded={accountOpen} aria-haspopup="dialog" aria-controls="workspace-account-menu" popoverTarget="workspace-account-menu"><span className="workspace-account-name">{displayName}</span><WorkspaceIcon name="chevron" /></button>
    <div ref={notifications} id="workspace-notifications" popover="auto" role="dialog" aria-labelledby="notifications-heading" className="workspace-popover workspace-notifications-panel" onToggle={event => {
      const open = event.newState === "open"; setNotificationsOpen(open);
      if (open) void loadActivity(); else request.current?.abort();
    }}>
      <div className="workspace-popover-heading"><h2 id="notifications-heading">{t.notifications}</h2><button type="button" className="workspace-popover-close" aria-label={t.closeNotifications} onClick={() => notifications.current?.hidePopover()}>×</button></div>
      <p className="workspace-popover-description">{t.activityHint}</p>
      <div aria-live="polite" aria-busy={feed.status === "loading"}>
        {(feed.status === "idle" || feed.status === "loading") && <p className="workspace-feed-message">{t.loadingActivity}</p>}
        {feed.status === "error" && <div className="workspace-feed-message"><p>{t.activityError}</p><button type="button" className="workspace-text-link" onClick={() => void loadActivity()}>{t.retryActivity}</button></div>}
        {feed.status === "ready" && (feed.items.length ? <ul className="workspace-activity-list">{feed.items.map(item => <li key={item.id}><Link href={`/dashboard/bookings/${item.bookingId}`} onClick={() => notifications.current?.hidePopover()}><span className="workspace-activity-icon"><WorkspaceIcon name={item.type === "rescheduled" ? "clock" : "calendar"} /></span><span><strong>{t.activityTypes[item.type]}</strong><span className="workspace-activity-title">{item.title}</span><time dateTime={item.createdAt}>{new Intl.DateTimeFormat("ru-RU", { timeZone: item.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(new Date(item.createdAt))}</time></span><WorkspaceIcon name="chevron" /></Link></li>)}</ul> : <p className="workspace-feed-message">{t.noActivity}</p>)}
      </div>
      <Link href="/dashboard/bookings" className="workspace-popover-footer" onClick={() => notifications.current?.hidePopover()}>{t.all}<WorkspaceIcon name="chevron" /></Link>
    </div>
    <div ref={account} id="workspace-account-menu" popover="auto" role="dialog" aria-labelledby="account-heading" className="workspace-popover workspace-account-panel" onToggle={event => setAccountOpen(event.newState === "open")}>
      <div className="workspace-popover-heading"><h2 id="account-heading">{t.account}</h2><button type="button" className="workspace-popover-close" aria-label={t.closeAccount} onClick={() => account.current?.hidePopover()}>×</button></div>
      <p className="workspace-popover-name">{displayName}</p>
      <nav aria-label={t.account}><Link href="/dashboard/settings" onClick={() => account.current?.hidePopover()}><WorkspaceIcon name="settings" />{t.accountSettings}</Link><Link href="/dashboard/schedule" onClick={() => account.current?.hidePopover()}><WorkspaceIcon name="calendar" />{t.configureSchedule}</Link></nav>
      <div className="workspace-account-signout"><SignOut /></div>
    </div>
  </div>;
}
