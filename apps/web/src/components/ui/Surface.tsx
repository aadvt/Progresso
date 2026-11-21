import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import styles from "./Surface.module.css";

type SurfaceProps<T extends ElementType> = {
  as?: T;
  /** 1 = quiet panel, 2 = card, 3 = hero / raised. */
  level?: 1 | 2 | 3;
  pad?: "none" | "sm" | "md" | "lg";
  /** Adds the hover lift used by clickable cards. */
  interactive?: boolean;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

/** A frosted-glass surface. The one container every screen is built from. */
export function Surface<T extends ElementType = "div">({
  as,
  level = 2,
  pad = "md",
  interactive = false,
  className,
  children,
  ...rest
}: SurfaceProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  const cls = [styles.surface, styles[`l${level}`], styles[`p-${pad}`], interactive ? styles.interactive : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  );
}
