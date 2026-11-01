"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/modules/identity/client";
import { organizerName } from "@/modules/identity/validation";
import { fieldClass, FormNotice, primaryButton } from "@/components/ui/form";
import { dashboard as t } from "@/i18n/messages/ru/dashboard";

export function AccountSettings({ initialName, email }: { initialName: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [success, setSuccess] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    setError(""); setSuccess("");
    const parsed = organizerName.safeParse(name);
    if (!parsed.success) { setError(t.invalidAccountName); return; }
    setPending(true);
    try {
      const result = await authClient.updateUser({ name: parsed.data });
      if (result.error) { setError(t.accountSaveError); return; }
      setName(parsed.data); setSuccess(t.accountSaved); router.refresh();
    } catch { setError(t.accountSaveError); } finally { setPending(false); }
  }
  return <form className="workspace-settings-form workspace-surface" onSubmit={save} aria-busy={pending}>
    <div><label htmlFor="account-name">{t.accountName}</label><input className={fieldClass} id="account-name" value={name} onChange={event => { setName(event.target.value); setError(""); setSuccess(""); }} required maxLength={100} autoComplete="name" disabled={pending} /><p>{t.accountNameHint}</p></div>
    <div><span className="workspace-settings-label">{t.accountEmail}</span><p className="workspace-settings-email">{email}<span>{t.emailVerified}</span></p><p>{t.accountEmailHint}</p></div>
    <FormNotice error={error} success={success} />
    <button type="submit" className={primaryButton} disabled={pending}>{pending ? t.savingAccount : t.saveAccount}</button>
  </form>;
}
