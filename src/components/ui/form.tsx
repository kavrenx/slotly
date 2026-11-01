export const fieldClass = "w-full rounded-xl border border-line bg-paper px-3.5 py-3 text-sm outline-offset-2 disabled:opacity-60";
export const primaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-ink disabled:cursor-wait disabled:opacity-50";
export const secondaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-paper px-4 py-2.5 text-sm font-medium transition-colors hover:bg-panel disabled:cursor-wait disabled:opacity-50";
export function FormNotice({ error, success }: { error: string; success?: string }) {
  return <>{error && <p role="alert" className="feedback-message-in rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">{error}</p>}
    {success && <p role="status" className="feedback-message-in rounded-xl border border-accent/20 bg-accent/5 p-4 text-sm text-accent">{success}</p>}</>;
}
