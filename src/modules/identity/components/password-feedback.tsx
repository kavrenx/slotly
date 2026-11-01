"use client";

import { useEffect, useState } from "react";
import { identity } from "@/i18n/messages/ru/identity";
import { assessPassword } from "../password-strength";
import { getPasswordIssues, passwordIssueCodes } from "../validation";

const t = identity.passwordFeedback;
const colors = ["bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-600", "bg-accent"];

export function StatusIcon({ done }: { done: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4 shrink-0">
    {done ? <><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="m4.5 8 2.3 2.3 4.7-4.7" stroke="var(--color-paper)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></> : <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.25" />}
  </svg>;
}

export function PasswordFeedback({ password }: { password: string }) {
  // Keep a rating across eligible edits, but discard it when the field is
  // cleared or an immediate composition error makes that rating inapplicable.
  const mode = !password ? "empty" : getPasswordIssues(password).length ? "invalid" : "eligible";
  return <div id="password-feedback" className="feedback-reveal" data-visible={Boolean(password)} aria-hidden={!password}>
    <div className="min-h-0 overflow-hidden"><PasswordFeedbackContent key={mode} password={password} /></div>
  </div>;
}

function PasswordFeedbackContent({ password }: { password: string }) {
  const [assessment, setAssessment] = useState<{
    input: string; value: Awaited<ReturnType<typeof assessPassword>> | null;
  } | null>(null);
  useEffect(() => {
    if (!password || getPasswordIssues(password).length > 0) return;
    let active = true;
    const timer = setTimeout(() => {
      void assessPassword(password).then(
        (value) => { if (active) setAssessment({ input: password, value }); },
        () => { if (active) setAssessment({ input: password, value: null }); },
      );
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [password]);

  const current = assessment?.input === password ? assessment : null;
  const issues = getPasswordIssues(password);
  const checking = Boolean(password) && issues.length === 0 && !current;
  const displayed = current ?? assessment;
  const score = issues.length === 0 ? displayed?.value?.score ?? 0 : 0;
  const validLength = password.length >= 10 && password.length <= 128;
  const label = issues.length > 0 ? issues.map((issue) => identity.errors[issue]).join(" ")
    : !password ? t.empty : !current ? t.checking : !current.value ? t.unavailable : t.levels[score] ?? t.empty;
  const filled = !password ? 0 : issues.length ? 1 : displayed?.value ? Math.max(1, score) : 0;
  const warning = issues.length === 0 ? current?.value?.warning ?? "" : "";

  return <div className="pt-3">
        <div role="meter" aria-label={t.label} aria-valuemin={0} aria-valuemax={4} aria-valuenow={score} aria-valuetext={label} aria-busy={checking} data-checking={checking} className={`flex gap-1.5 motion-safe:transition-opacity motion-safe:duration-200 ${checking ? "opacity-60" : ""}`}>
          {[0, 1, 2, 3].map((index) => <span key={index} aria-hidden="true" className={`h-1.5 flex-1 rounded-full motion-safe:transition-colors motion-safe:duration-200 ${index < filled ? colors[score] : "bg-line"}`} />)}
        </div>
        <p className={`mt-2.5 flex items-center gap-2 text-xs ${validLength ? "text-accent" : "text-muted"}`}>
          <StatusIcon done={validLength} /><span>{identity.passwordHint}</span>
          <span role="status" className="ml-auto text-[10px] text-muted">{checking ? t.checking : current && !current.value ? t.unavailable : ""}</span>
        </p>
        {passwordIssueCodes.map((issue) => <div key={issue} className="feedback-reveal" data-visible={Boolean(password) && issues.includes(issue)} aria-hidden={!password || !issues.includes(issue)}>
          <div className="min-h-0 overflow-hidden">
            <p aria-live="polite" className="feedback-message-in pt-2 text-xs leading-5 text-rose-700">{identity.errors[issue]}</p>
          </div>
        </div>)}
        <div className="feedback-reveal" data-visible={Boolean(warning)} aria-hidden={!warning}>
          <div className="min-h-0 overflow-hidden">
            <p key={warning} aria-live="polite" className="feedback-message-in pt-2 text-xs leading-5 text-rose-700">{warning}</p>
          </div>
        </div>
  </div>;
}
