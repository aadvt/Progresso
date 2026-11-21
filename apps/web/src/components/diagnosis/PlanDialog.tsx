"use client";

import type { DiagnosisView } from "@progresso/core";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import type { StudentSummary } from "@/lib/types";
import { joinNames, plural } from "@/lib/format";
import styles from "./PlanDialog.module.css";

/** Placeholder for "Start my comeback plan" until the mission engine (Phase 5). */
export function PlanDialog({
  open,
  onClose,
  view,
  student,
}: {
  open: boolean;
  onClose: () => void;
  view: DiagnosisView;
  student: StudentSummary;
}) {
  const missions = view.roots.reduce((s, r) => s + r.missions, 0);
  const focus = view.roots.length > 0 ? joinNames(view.roots.map((r) => r.concept.name)) : "your checking habits";
  const exam = student.next_exam && student.next_exam.days_left > 0 ? student.next_exam : undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      placement="center"
      title="Your comeback plan is almost here"
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className={styles.body}>
        <p>
          Plans aren&apos;t switched on in this prototype yet. When they are, this button will turn your diagnosis into a plan
          like this:
        </p>
        <ul className={styles.list} role="list">
          <li>
            <Icon name="target" size={18} />
            <span>
              Focus on <strong>{focus}</strong>
              {missions > 0 && <>, in about {plural(missions, "mission")} of 25 minutes</>}.
            </span>
          </li>
          <li>
            <Icon name="check" size={18} />
            <span>Short &ldquo;prove it&rdquo; questions, built from your own mistakes, to show each gap is fixed.</span>
          </li>
          <li>
            <Icon name="calendar" size={18} />
            <span>{exam ? `Spaced out so it all sticks until ${exam.name}, ${plural(exam.days_left, "day")} away.` : "Spaced out so it all sticks until exam day."}</span>
          </li>
        </ul>
      </div>
    </Dialog>
  );
}
