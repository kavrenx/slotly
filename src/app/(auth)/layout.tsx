import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { SectionLink } from "@/components/ui/section-link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-svh max-w-7xl flex-col px-6 sm:px-12 lg:px-20">
      <SectionLink className="skip-link" section="auth-main">Перейти к форме</SectionLink>
      <header className="py-7 sm:py-10"><Link href="/" className="inline-flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><BrandMark />Slotly</Link></header>
      <main id="auth-main" tabIndex={-1} className="flex flex-1 items-center justify-center py-10 sm:py-14">
        {children}
      </main>
      <footer className="border-t border-line py-7 text-xs text-muted">Your time. Your rules.</footer>
    </div>
  );
}
