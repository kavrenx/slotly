import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { SectionLink } from "@/components/ui/section-link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-svh max-w-7xl flex-col px-6 sm:px-12 lg:px-20">
      <SectionLink className="skip-link" section="auth-main">Перейти к форме</SectionLink>
      <header className="py-7 sm:py-10"><Link href="/" className="inline-flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><BrandMark />Slotly</Link></header>
      <main id="auth-main" tabIndex={-1} className="grid flex-1 items-center gap-12 py-10 sm:py-16 lg:grid-cols-2 lg:gap-24">
        <div className="hidden self-center lg:block">
          <p className="text-sm font-medium text-accent">Ваше время — по вашим правилам</p>
          <p className="mt-6 text-5xl leading-tight font-medium tracking-[-0.045em]">Больше времени<br />для главного.</p>
          <p className="mt-6 max-w-sm text-base leading-8 text-muted">Простое начало для удобных встреч. Бесплатно, без рекламы и лишних шагов.</p>
        </div>
        <div className="flex justify-center lg:justify-end">{children}</div>
      </main>
      <footer className="border-t border-line py-7 text-xs text-muted">Slotly · Your time. Your rules.</footer>
    </div>
  );
}
