"use client";
import { secondaryButton } from "@/components/ui/form";
export default function DashboardError({ reset }: { reset: () => void }) {
  return <section className="py-10"><h1 className="text-2xl font-medium">Не удалось загрузить кабинет</h1><p className="mt-4 text-sm text-muted">Попробуйте ещё раз. Несохранённые изменения не были записаны.</p><button onClick={reset} className={secondaryButton + " mt-6"}>Повторить</button></section>;
}
