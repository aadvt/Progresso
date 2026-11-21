import Link from "next/link";
import type { StudentSummary } from "@/lib/types";
import { StudentAvatar } from "./StudentAvatar";
import styles from "./StudentChip.module.css";

/** The current student, in the top bar. Links back to the picker to switch. */
export function StudentChip({ student, seed }: { student: StudentSummary; seed: number }) {
  // The accessible name is the visible text ("Riya, Class 12, Switch student"), so voice control matches what is seen.
  return (
    <Link href="/" className={styles.chip}>
      <StudentAvatar name={student.name} seed={seed} size="sm" />
      <span className={styles.text}>
        <span className={styles.name}>{student.name}</span>
        <span className={styles.meta}>
          <span className="visually-hidden">, </span>Class {student.class}
        </span>
      </span>
      <span className={styles.switch}>
        <span className="visually-hidden">, </span>Switch<span className="visually-hidden"> student</span>
      </span>
    </Link>
  );
}
