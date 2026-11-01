import { planning } from "@/i18n/messages/ru/planning";
import type { PageState } from "../validation";
const colors = { draft: "bg-panel text-muted", published: "bg-accent/10 text-accent", paused: "bg-amber-100 text-amber-900", archived: "bg-line/50 text-muted" };
export function StateBadge({ state }: { state: PageState }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium ${colors[state]}`}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{planning.states[state]}</span>;
}
