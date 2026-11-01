import Link from "next/link";
import { requireOrganizer } from "@/modules/organizers/server";
import { AccountSettings } from "@/modules/organizers/components/account-settings";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";

export default async function SettingsPage() {
  const owner = await requireOrganizer();
  return <div><p className="workspace-eyebrow">{t.account}</p><h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">{t.accountSettings}</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-muted">{t.accountHint}</p>
    <AccountSettings initialName={owner.displayName} email={owner.email} />
    <p className="mt-6 text-sm text-muted">{t.timeSettingsHint} <Link className="text-accent underline underline-offset-4" href="/dashboard/schedule">{t.configureSchedule}</Link></p>
  </div>;
}
