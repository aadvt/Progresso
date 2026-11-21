import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./StudentNav.module.css";

const TABS: { id: "today" | "plan" | "diagnosis" | "constellation"; label: string; icon: IconName }[] = [
  { id: "today", label: "Today", icon: "sun" },
  { id: "plan", label: "Plan", icon: "calendar" },
  { id: "diagnosis", label: "Diagnosis", icon: "target" },
  { id: "constellation", label: "Map", icon: "map" },
];

/** The student's sections. Sits under the top bar; a bottom tab bar on phones. */
export function StudentNav({ studentId, current }: { studentId: string; current: (typeof TABS)[number]["id"] }) {
  return (
    <nav className={styles.nav} aria-label="Your sections">
      <ul role="list" className={`container ${styles.list}`}>
        {TABS.map((t) => (
          <li key={t.id}>
            <Link href={`/s/${studentId}/${t.id}`} className={styles.tab} aria-current={t.id === current ? "page" : undefined}>
              <Icon name={t.icon} size={18} />
              <span>{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
