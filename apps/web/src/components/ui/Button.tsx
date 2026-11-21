import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

interface Common {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Icon after the label (e.g. an arrow). */
  trailingIcon?: IconName;
  block?: boolean;
  children: ReactNode;
  className?: string;
}

function classes({ variant = "primary", size = "md", block, className }: Common): string {
  return [styles.button, styles[variant], styles[size], block ? styles.block : "", className ?? ""].filter(Boolean).join(" ");
}

function Content({ icon, trailingIcon, children, size = "md" }: Common) {
  const s = size === "lg" ? 20 : 18;
  return (
    <>
      {icon && <Icon name={icon} size={s} />}
      <span className={styles.label}>{children}</span>
      {trailingIcon && <Icon name={trailingIcon} size={s} className={styles.trailing} />}
    </>
  );
}

export function Button(props: Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  const { variant, size, icon, trailingIcon, block, children, className, type = "button", ...rest } = props;
  const common = { variant, size, icon, trailingIcon, block, children, className };
  return (
    <button type={type} className={classes(common)} {...rest}>
      <Content {...common} />
    </button>
  );
}

export function ButtonLink(props: Common & { href: string; prefetch?: boolean }) {
  const { href, prefetch, ...common } = props;
  return (
    <Link href={href} prefetch={prefetch} className={classes(common)}>
      <Content {...common} />
    </Link>
  );
}
