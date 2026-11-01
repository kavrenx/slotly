"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { identity as t } from "@/i18n/messages/ru/identity";
import { authClient } from "../client";
import { emailInput, getPasswordIssues, organizerName } from "../validation";
import { PasswordFeedback } from "./password-feedback";

export type AuthMode = keyof typeof t.headings;
export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const token = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const hasPassword = ["register", "login", "reset"].includes(mode);
  const repeatPassword = mode === "register" || mode === "reset";
  const hasEmail = !["reset", "verify"].includes(mode);
  const confirmationMismatch = Boolean(confirmation) && confirmation !== passwordValue;

  function readToken() {
    token.current ??= new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    return token.current;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(""); setSuccess("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim();
    try {
      const passwordIssue = repeatPassword ? getPasswordIssues(password)[0] : undefined;
      if (passwordIssue) {
        setError(t.errors[passwordIssue] ?? t.genericError); return;
      }
      if ((hasEmail && !emailInput.safeParse(email).success) ||
          (mode === "register" && !organizerName.safeParse(name).success)) {
        setError(t.invalidFields); return;
      }
      if (repeatPassword && password !== data.get("repeatPassword")) { setError(t.differentPasswords); return; }
      if (mode === "verify") {
        const value = readToken();
        if (!value) { setError(t.missingToken); return; }
        const result = await fetch("/api/identity/verify-email", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: value }),
        });
        if (!result.ok) { setError(result.status >= 500 ? t.genericError : result.status === 429 ? t.errors.TOO_MANY_REQUESTS ?? t.genericError : t.errors.INVALID_TOKEN ?? t.genericError); return; }
        setSuccess(t.verified); return;
      }
      const result = mode === "register"
        ? await authClient.signUp.email({ name, email, password })
        : mode === "login"
          ? await authClient.signIn.email({ email, password })
          : mode === "forgot"
            ? await authClient.requestPasswordReset({ email, redirectTo: new URL("/reset-password", window.location.origin).toString() })
            : mode === "resend"
              ? await authClient.sendVerificationEmail({ email })
              : await authClient.resetPassword({ newPassword: password, token: readToken() ?? "" });
      if (result.error) {
        setError(result.error.status === 429 ? t.errors.TOO_MANY_REQUESTS ?? t.genericError : t.errors[result.error.code ?? ""] ?? t.genericError);
        return;
      }
      if (mode === "register") { router.replace("/check-email"); return; }
      if (mode === "login") { router.replace("/dashboard"); router.refresh(); return; }
      setSuccess(mode === "reset" ? t.resetDone : t.mailSent);
    } catch {
      setError(t.genericError);
    } finally { setPending(false); }
  }
  const inputClass = "mt-2 w-full rounded-xl border border-line bg-paper px-4 py-3 text-base outline-offset-2";
  return (
    <section aria-labelledby="auth-title" className="w-full max-w-md">
      <h1 id="auth-title" className="text-3xl leading-tight font-medium tracking-tight sm:text-4xl">{t.headings[mode]}</h1>
      <p className="mt-4 text-sm leading-7 text-muted">{t.descriptions[mode]}</p>
      {success ? (
        <div className="mt-8 space-y-5">
          <p role="status" className="rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm leading-7">{success}</p>
          <Link className="text-sm font-medium text-accent underline underline-offset-4" href="/login">Перейти ко входу</Link>
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={pending} className="mt-8 space-y-5">
          {mode === "register" && <label className="block text-sm font-medium" htmlFor="name">{t.name}<input className={inputClass} id="name" name="name" autoComplete="name" required maxLength={100} /></label>}
          {hasEmail && <label className="block text-sm font-medium" htmlFor="email">{t.email}<input className={inputClass} id="email" name="email" type="email" autoComplete="email" required maxLength={254} /></label>}
          {hasPassword && <div>
            <label className="block text-sm font-medium" htmlFor="password">{t.password}</label>
            <div className="relative">
              <input className={inputClass + " pr-12"} id="password" name="password" type={showPassword ? "text" : "password"} value={passwordValue}
                onChange={(event) => { setPasswordValue(event.target.value); setError(""); }}
                aria-invalid={repeatPassword && Boolean(passwordValue) && getPasswordIssues(passwordValue).length > 0 ? true : undefined}
                aria-describedby={repeatPassword ? "password-feedback" : undefined}
                autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 10} maxLength={128} />
              <button type="button" aria-label={showPassword ? t.passwordFeedback.hide : t.passwordFeedback.show} aria-pressed={showPassword}
                className="absolute right-1 top-3 grid size-10 place-items-center rounded-lg text-muted hover:bg-panel hover:text-ink"
                onClick={() => setShowPassword((shown) => !shown)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                  {showPassword && <path d="m3 3 18 18" />}
                </svg>
              </button>
            </div>
            {repeatPassword && <PasswordFeedback password={passwordValue} />}
          </div>}
          {repeatPassword && <div>
            <label className="block text-sm font-medium" htmlFor="repeat-password">{t.repeatPassword}</label>
            <input className={inputClass} id="repeat-password" name="repeatPassword" type={showPassword ? "text" : "password"} value={confirmation}
              onChange={(event) => { setConfirmation(event.target.value); setError(""); }}
              aria-invalid={confirmationMismatch ? true : undefined}
              aria-describedby={confirmationMismatch ? "password-match" : undefined} autoComplete="new-password" required minLength={10} maxLength={128} />
            <div className="feedback-reveal" data-visible={confirmationMismatch} aria-hidden={!confirmationMismatch}>
              <div className="min-h-0 overflow-hidden">
                <p id="password-match" aria-live="polite" className="pt-2 text-xs leading-5 text-rose-700">{confirmationMismatch ? t.passwordFeedback.mismatch : ""}</p>
              </div>
            </div>
          </div>}
          {error && <p key={error} role="alert" className="feedback-message-in rounded-xl border border-red-300 bg-red-50 p-4 text-sm leading-6 text-red-900">{error}</p>}
          <button disabled={pending} className="w-full rounded-xl bg-accent px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-ink disabled:cursor-wait disabled:opacity-60">{pending ? t.pending : t.buttons[mode]}</button>
        </form>
      )}
      <nav aria-label="Доступ к аккаунту" className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-sm text-accent">
        {mode !== "login" && <Link className="underline underline-offset-4" href="/login">Войти</Link>}
        {mode === "login" && <><Link className="underline underline-offset-4" href="/register">Создать аккаунт</Link><Link className="underline underline-offset-4" href="/forgot-password">Забыли пароль?</Link></>}
        {(mode === "login" || mode === "verify") && <Link className="underline underline-offset-4" href="/check-email">Подтвердить почту</Link>}
        {mode === "reset" && <Link className="underline underline-offset-4" href="/forgot-password">Запросить новую ссылку</Link>}
      </nav>
    </section>
  );
}
