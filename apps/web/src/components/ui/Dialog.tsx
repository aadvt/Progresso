"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./Dialog.module.css";

/**
 * Modal built on the native <dialog>: focus is trapped and Escape closes it
 * for free. `placement="side"` is a sheet from the right on desktop and from
 * the bottom on phones; "center" is a small centred dialog.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  placement = "side",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  placement?: "side" | "center";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      document.documentElement.dataset.modal = "open";
    } else if (!open && el.open) {
      el.close();
    }
    return () => {
      delete document.documentElement.dataset.modal;
    };
  }, [open]);

  return (
    // Backdrop click is a mouse shortcut; Escape and the Close button are the keyboard equivalents.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[placement]}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, outside the panel) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.headings}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </header>
        {/* Focusable so keyboard users can scroll long content (e.g. the report) with arrow keys. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <div className={styles.body} role="region" aria-labelledby={titleId} tabIndex={0}>
          {children}
        </div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </dialog>
  );
}
