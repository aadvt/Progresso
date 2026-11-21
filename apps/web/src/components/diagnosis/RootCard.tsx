"use client";

import { useId, useState } from "react";
import type { ChainNode, RootView } from "@progresso/core";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Surface } from "@/components/ui/Surface";
import { hours, joinNames, marks, plural } from "@/lib/format";
import { EvidenceCard } from "./EvidenceCard";
import styles from "./RootCard.module.css";

const CONFIDENCE = {
  high: { tone: "teal", text: "Strong evidence" },
  medium: { tone: "blue", text: "Good evidence" },
  low: { tone: "neutral", text: "Some evidence" },
} as const;

export function RootCard({ root, defaultOpen = false }: { root: RootView; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const conf = CONFIDENCE[root.confidence_label];
  const repeated = root.misconceptions.filter((m) => m.count >= 2);
  const surfaced = root.surfaced_in.map((c) => c.name);

  return (
    <Surface as="article" level={2} pad="none" className={styles.card} data-open={open || undefined} aria-labelledby={`${panelId}-title`}>
      <div className={styles.head}>
        <span className={styles.rank} aria-hidden="true">
          {root.rank}
        </span>
        <div className={styles.titles}>
          <p className={styles.kicker}>
            <span className="visually-hidden">Root gap {root.rank}: </span>
            Class {root.concept.class} · {root.concept.subject} · {root.concept.chapter}
          </p>
          <h3 id={`${panelId}-title`} className={styles.title}>
            {root.concept.name}
          </h3>
        </div>
        <Badge tone={conf.tone} dot className={styles.conf}>
          {conf.text}
        </Badge>
      </div>

      <dl className={styles.stats}>
        <div>
          <dt>Explains</dt>
          <dd className="tabular">{plural(root.error_count, "mistake")}</dd>
        </div>
        <div>
          <dt>Across</dt>
          <dd className="tabular">{plural(root.exam_count, "exam")}</dd>
        </div>
        <div data-accent>
          <dt>Marks lost</dt>
          <dd className="tabular">
            {root.marks_estimated ? "~" : ""}
            {marks(root.marks_lost)}
          </dd>
        </div>
        <div>
          <dt>To fix</dt>
          <dd className="tabular">
            ~{hours(root.study_hours)}
            <span className={styles.ddSub}> · {plural(root.missions, "mission")}</span>
          </dd>
        </div>
      </dl>

      {surfaced.length > 0 && (
        <p className={styles.surfaced}>
          <span className={styles.surfacedLabel}>Shows up in</span> {joinNames(surfaced, 4)}
        </p>
      )}

      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{open ? "Hide the evidence" : "Why this is the root"}</span>
        <Icon name="chevronDown" size={18} className={styles.chev} />
      </button>

      <div id={panelId} className={styles.panel} hidden={!open}>
        <p className={styles.explanation}>{root.explanation}</p>

        {repeated.map((m) => (
          <div key={m.id} className={styles.repeat}>
            <Icon name="repeat" size={18} />
            <p>
              <strong>The same wrong idea, {m.count} times:</strong> {m.description}
            </p>
          </div>
        ))}

        <h4 className={styles.subhead}>How one gap spreads</h4>
        <p className={styles.howto}>
          Each step down is a topic built on the one above. The cards are the mistakes, in the report&apos;s own words.
        </p>
        <ol className={styles.tree} role="list">
          <TreeNode node={root.chain} depth={0} />
        </ol>

        <Certainty root={root} />
      </div>
    </Surface>
  );
}

/**
 * Collapse runs of topics that only lead on to one other topic (and hold no
 * mistakes of their own) into a single path, so a deep chain reads as one line:
 * "used in Factorisation → Algebraic fractions → Algebraic limits → Continuity".
 */
function compress(node: ChainNode): { path: ChainNode["concept"][]; end: ChainNode } {
  const path = [node.concept];
  let end = node;
  while (end.errors.length === 0 && end.children.length === 1) {
    end = end.children[0]!;
    path.push(end.concept);
  }
  return { path, end };
}

function TreeNode({ node, depth }: { node: ChainNode; depth: number }) {
  // The root always stands alone; below it, single-child runs are merged.
  const { path, end } = depth === 0 ? { path: [node.concept], end: node } : compress(node);
  return (
    <li className={styles.node} data-root={depth === 0 || undefined}>
      <div className={styles.nodeHead}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.nodeName}>
          {depth > 0 && <span className={styles.usedIn}>used in </span>}
          {path.map((c, i) => (
            <span key={c.id} className={styles.step}>
              {i > 0 && (
                <>
                  <span className={styles.stepArrow} aria-hidden="true">
                    →
                  </span>
                  <span className="visually-hidden">, then </span>
                </>
              )}
              {c.name}
            </span>
          ))}
        </span>
        {depth === 0 && <span className={styles.nodeTag}>the root</span>}
      </div>
      {(end.errors.length > 0 || end.children.length > 0) && (
        <div className={styles.branch}>
          {end.errors.length > 0 && (
            <ul className={styles.errors} role="list">
              {end.errors.map((e) => (
                <EvidenceCard
                  key={e.evidence.record_id}
                  evidence={e.evidence}
                  marks={e.marks}
                  note={e.in_question_on ? `In a question on ${e.in_question_on.name}; the report points back to this step.` : undefined}
                />
              ))}
            </ul>
          )}
          {end.children.length > 0 && (
            <ol className={styles.children} role="list">
              {end.children.map((c) => (
                <TreeNode key={c.concept.id} node={c} depth={depth + 1} />
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

function Certainty({ root }: { root: RootView }) {
  const { branches, branches_with_errors, root_itself } = root.coverage;
  return (
    <div className={styles.certainty}>
      <h4 className={styles.subhead}>How sure we are</h4>
      <ul className={styles.facts} role="list">
        <li>
          <span className={styles.meter} aria-hidden="true">
            <span style={{ transform: `scaleX(${root.confidence})` }} />
          </span>
          {Math.round(root.confidence * 100)}% confident this is a real gap, from {plural(root.error_count, "mistake")} in{" "}
          {plural(root.exam_count, "exam")}.
        </li>
        {branches > 0 && (
          <li>
            Mistakes in {branches_with_errors} of the {branches} topics built directly on {root.concept.name}
            {root_itself ? `, and in ${root.concept.name} itself` : ""}.
          </li>
        )}
        {root.close_alternatives.map((a) => (
          <li key={a.concept.id}>
            Close call: {a.concept.name} would explain these almost as well ({Math.round(a.relative_fit * 100)}% as good a fit).
          </li>
        ))}
        {root.evidence_against.length > 0 && (
          <li>
            {plural(root.evidence_against.length, "answer")} suggest{root.evidence_against.length === 1 ? "s" : ""} parts of this
            already work, so we lowered our confidence.
          </li>
        )}
      </ul>
    </div>
  );
}
