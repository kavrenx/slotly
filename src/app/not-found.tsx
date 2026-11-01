import Link from "next/link";
import { secondaryButton } from "@/components/ui/form";
export default function NotFound() {
  return <div className="mx-auto max-w-xl px-6 py-24"><p className="text-xs font-semibold tracking-widest text-accent">SLOTLY · 404</p><h1 className="mt-5 text-3xl font-medium tracking-tight">Страница недоступна</h1><p className="mt-4 text-sm leading-7 text-muted">Проверьте ссылку. Возможно, владелец приостановил страницу или перенёс её в архив.</p><Link href="/" className={secondaryButton + " mt-7"}>На главную</Link></div>;
}
