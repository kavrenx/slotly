"use client";
import { useId, useRef, useState } from "react";
import { FooterIcon } from "@/components/landing/footer-icon";
import { community as t } from "@/i18n/messages/ru/community";
import styles from "./community.module.css";

export function CommunityLinks({ compact = false }: { compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(0);
  return <>
    <div role="group" aria-label={t.label} className={styles.links}>
      <a href="https://github.com/kavrenx/slotly" target="_blank" rel="noopener noreferrer" aria-label={t.github} title={t.github}><FooterIcon name="github" /></a>
      <button type="button" disabled aria-label={t.telegram} title={t.telegram}><FooterIcon name="telegram" /></button>
      <button type="button" aria-label={t.tea} title={t.tea} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => { setChoice(0); dialog.current?.showModal(); setOpen(true); }}><FooterIcon name="cup-hot" />{!compact && <span>{t.tea}</span>}</button>
    </div>
    <dialog ref={dialog} id={id} data-slotly-support aria-labelledby={`${id}-title`} aria-describedby={`${id}-description ${id}-hint`} className={styles.dialog} onClose={() => setOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close();
    }}>
      <button type="button" autoFocus className={styles.close} aria-label={t.close} onClick={() => dialog.current?.close()}>×</button>
      <div className={styles.icon} aria-hidden="true"><FooterIcon name="cup-hot" /></div>
      <span className={styles.badge}>{t.preview}</span>
      <h2 id={`${id}-title`}>{t.title}</h2><p id={`${id}-description`} className={styles.description}>{t.description}</p>
      <div role="group" aria-label={t.choice} className={styles.choices}>{t.cups.map((label, index) => <button key={label} type="button" aria-pressed={choice === index} onClick={() => setChoice(index)}><span aria-hidden="true">{[1, 3, 5][index]} × <FooterIcon name="cup-hot" /></span>{label}</button>)}</div>
      <div className={styles.notice}><p>{t.thanks}</p><p id={`${id}-hint`}>{t.hint}</p></div>
      <button type="button" disabled className={styles.payment}>{t.action}</button>
      <p className={styles.footer}>{t.footer}</p>
    </dialog>
  </>;
}
