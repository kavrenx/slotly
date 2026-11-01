import { BrandMark } from "@/components/ui/brand-mark";
import { landing as t } from "@/i18n/messages/ru/landing";
import { BookingPreview } from "@/components/landing/booking-preview";
import { BookingDemo, DemoButton } from "@/components/landing/booking-demo";
import { DashboardPreview } from "@/components/landing/dashboard-preview";
import { Icon } from "@/components/landing/icon";
import { FooterIcon } from "@/components/landing/footer-icon";
import type { Metadata } from "next";
import Link from "next/link";
import { SectionLink } from "@/components/ui/section-link";
import "./landing.css";

export const metadata: Metadata = {
  title: "Slotly — меньше переписки, больше встреч",
  description: "Бесплатная запись на встречи по ссылке. Настройте расписание, поделитесь страницей и позвольте участникам выбрать удобное время.",
};

export default function HomePage() {
  return (
    <div className="landing">
      <SectionLink section="main" className="skip-link">Перейти к содержимому</SectionLink>
      <header className="landing-header landing-container">
        <Link href="/" aria-label="Slotly — главная" className="landing-brand">
          <BrandMark />Slotly
        </Link>
        <nav aria-label="О продукте" className="landing-nav">{t.nav.map(item => <SectionLink key={item.href} section={item.href.slice(1)}>{item.label}</SectionLink>)}</nav>
        <nav aria-label="Аккаунт" className="landing-account">
          <Link href="/login">{t.login}</Link><Link href="/register" className="landing-button landing-button-small">{t.startShort}<Icon name="arrow" /></Link>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="landing-hero landing-container" aria-labelledby="intro-title">
          <BookingDemo>
          <div className="landing-hero-copy"><h1 id="intro-title">{t.title[0]}<br /><span>{t.title[1]}</span></h1><p className="landing-hero-description">{t.description}</p><div className="landing-hero-actions"><Link href="/register" className="landing-button">{t.start}<Icon name="arrow" /></Link><DemoButton /></div><ul className="landing-promises">{t.promises.map(promise => <li key={promise}><Icon name="check" />{promise}</li>)}</ul></div>
          <BookingPreview />
          </BookingDemo>
        </section>
        <div className="landing-container"><ul className="landing-benefits">{t.benefits.map(benefit => <li key={benefit.title}><span className="landing-benefit-icon"><Icon name={benefit.icon} /></span><div><h2>{benefit.title}</h2><p>{benefit.text}</p></div></li>)}</ul></div>
        <section id="how-it-works" className="landing-section landing-container" aria-labelledby="how-title"><div className="landing-section-heading"><p className="landing-eyebrow">{t.how.eyebrow}</p><h2 id="how-title">{t.how.title}</h2><p>{t.how.description}</p></div><ol className="landing-steps">{t.how.steps.map((step, i) => <li key={step.title}><div className="landing-step-top"><span className="landing-step-number">0{i + 1}</span><Icon name={step.icon} /></div><h3>{step.title}</h3><p>{step.text}</p>{i < 2 && <span className="landing-step-arrow"><Icon name="arrow" /></span>}</li>)}</ol></section>
        <section id="for-whom" className="landing-audience-section" aria-labelledby="audience-title"><div className="landing-container"><div className="landing-section-heading"><p className="landing-eyebrow">{t.audience.eyebrow}</p><h2 id="audience-title">{t.audience.title}</h2><p>{t.audience.description}</p></div><div className="landing-audiences">{t.audience.items.map(item => <article key={item.title}><Icon name={item.icon} /><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></div></section>
        <section id="features" className="landing-version landing-container" aria-labelledby="version-title"><div><p className="landing-eyebrow">{t.version.eyebrow}</p><h2 id="version-title">{t.version.title}</h2><p className="landing-version-description">{t.version.description}</p><ul>{t.version.features.map(feature => <li key={feature}><Icon name="check" />{feature}</li>)}</ul><p className="landing-version-note">{t.version.note}</p></div><DashboardPreview /></section>
        <section id="development" className="landing-container" aria-labelledby="future-title"><div className="landing-future"><div><p className="landing-eyebrow">{t.future.eyebrow}</p><h2 id="future-title">{t.future.title}</h2><p>{t.future.description}</p></div><div className="landing-future-action"><Link href="/register" className="landing-button landing-button-light">{t.future.action}<Icon name="arrow" /></Link><p>{t.future.note}</p></div></div></section>
      </main>
      <footer className="landing-footer landing-container">
        <div className="landing-footer-main">
          <div className="landing-footer-brand">
            <Link href="/" className="landing-brand" aria-label="Slotly — главная"><BrandMark />Slotly</Link>
            <p className="landing-footer-description">{t.footer.description}</p>
          </div>
          <div className="landing-footer-links">
            <nav aria-label="Ваш Slotly"><h2>{t.footer.account}</h2><Link href="/register">{t.footer.register}</Link><Link href="/dashboard">{t.footer.dashboard}</Link></nav>
            <nav aria-label="О проекте"><h2>{t.footer.about}</h2><SectionLink section="development">{t.footer.development}</SectionLink><span className="landing-footer-status"><i />{t.footer.status}</span></nav>
          </div>
          <div className="landing-footer-socials" role="group" aria-label={t.footer.socialLabel}>
            <button type="button" disabled aria-label={`GitHub — ${t.footer.comingSoon}`} title={`GitHub — ${t.footer.comingSoon}`}><FooterIcon name="github" /></button>
            <button type="button" disabled aria-label={`Telegram — ${t.footer.comingSoon}`} title={`Telegram — ${t.footer.comingSoon}`}><FooterIcon name="telegram" /></button>
            <button type="button" disabled aria-label={`${t.footer.tea} — ${t.footer.comingSoon}`} title={`${t.footer.tea} — ${t.footer.comingSoon}`}><FooterIcon name="cup-hot" /><span>{t.footer.tea}</span></button>
          </div>
        </div>
      </footer>
    </div>
  );
}
