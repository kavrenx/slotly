"use client";
import { useRef, useState } from "react";
import { identity as t } from "@/i18n/messages/ru/identity";
import { completeEmailDomain, emailDomains, emailFieldError } from "../email-suggestions";

export function EmailField({ inputClass }: { inputClass: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(""), [touched, setTouched] = useState(false);
  const issue = emailFieldError(value);
  const error = touched && issue ? issue === "required" ? t.emailRequired : t.invalidEmail : "";
  function update(next: string) {
    setValue(next);
    const invalid = emailFieldError(next);
    input.current?.setCustomValidity(invalid ? invalid === "required" ? t.emailRequired : t.invalidEmail : "");
  }
  return <div>
    <label className="block text-sm font-medium" htmlFor="email">{t.email}</label>
    <input ref={input} className={inputClass} id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254}
      value={value} onChange={event => update(event.target.value)} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? "email-feedback" : undefined}
      onBlur={event => { if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('[data-email-domain]'))) setTouched(true); }}
      onInvalid={event => { event.preventDefault(); update(event.currentTarget.value); setTouched(true); event.currentTarget.focus(); }} />
    <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={t.emailDomainsLabel}>
      {emailDomains.map(domain => <button key={domain} data-email-domain type="button" disabled={!completeEmailDomain(value, domain)}
        title={!completeEmailDomain(value, domain) ? t.emailDomainHint : `${t.emailDomainAction} @${domain}`}
        className="min-h-8 rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent/40 hover:bg-panel hover:text-accent disabled:cursor-default disabled:opacity-45 motion-reduce:transition-none"
        onClick={() => { const next = completeEmailDomain(value, domain); if (next) { update(next); input.current?.focus(); } }}>@{domain}</button>)}
    </div>
    <div className="feedback-reveal" data-visible={Boolean(error)} aria-hidden={!error}><div className="min-h-0 overflow-hidden"><p id="email-feedback" role="status" className="pt-2 text-xs leading-5 text-rose-700">{issue === "required" ? t.emailRequired : t.invalidEmail}</p></div></div>
  </div>;
}
