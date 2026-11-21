"use client";

/**
 * Side panel (bottom sheet on phones). With nothing selected it is the map's
 * key and the keyboard way in: the roots and the topics with mistakes are
 * buttons that focus the star. With a star selected it shows that topic's
 * mistakes in the report's own words and why it matters.
 */
import type { ConstellationModel, ConstellationNode, StarState } from "@progresso/core/constellation/client";
import { STATE_LABEL } from "@progresso/core/constellation/client";
import { Icon } from "@/components/ui/Icon";
import { marks, plural } from "@/lib/format";
import styles from "./ConceptPanel.module.css";

const SWATCH: Record<StarState, string> = {
  root: "var(--star-root)",
  weak: "var(--star-weak)",
  learning: "var(--star-learning)",
  mastered: "var(--star-mastered)",
  unassessed: "var(--star-unassessed)",
};

export function StateDot({ state }: { state: StarState }) {
  return <span className={`${styles.dot} ${state === "root" ? styles.dotRoot : ""}`} style={{ background: SWATCH[state] }} aria-hidden="true" />;
}

export function Legend({ counts, compact = false, only }: { counts?: Record<StarState, number>; compact?: boolean; only?: StarState[] }) {
  const order: StarState[] = only ?? ["root", "weak", "learning", "mastered", "unassessed"];
  return (
    <ul className={`${styles.legend} ${compact ? styles.legendCompact : ""}`} role="list" aria-label="Map key">
      {order.map((s) => (
        <li key={s}>
          <StateDot state={s} />
          <span>{STATE_LABEL[s]}</span>
          {counts && <span className={styles.count}>{counts[s]}</span>}
        </li>
      ))}
    </ul>
  );
}

interface DemoProps {
  enabled: boolean;
  pending: boolean;
  onMaster(rootId: string): void;
  onReset(): void;
}

export function ConceptPanel({
  model,
  selectedId,
  onSelect,
  demo,
}: {
  model: ConstellationModel;
  selectedId: string | null;
  onSelect(id: string | null): void;
  demo: DemoProps;
}) {
  const node = selectedId ? model.nodes.find((n) => n.id === selectedId) : undefined;
  return (
    <div className={styles.panel}>
      {node ? <ConceptDetail model={model} node={node} onSelect={onSelect} /> : <Overview model={model} onSelect={onSelect} demo={demo} />}
    </div>
  );
}

function NodeButton({ node, onSelect, meta }: { node: ConstellationNode; onSelect(id: string): void; meta?: string }) {
  return (
    <button type="button" className={styles.nodeButton} onClick={() => onSelect(node.id)}>
      <StateDot state={node.state} />
      <span className={styles.nodeName}>{node.name}</span>
      {meta && <span className={styles.nodeMeta}>{meta}</span>}
    </button>
  );
}

function Overview({ model, onSelect, demo }: { model: ConstellationModel; onSelect(id: string): void; demo: DemoProps }) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const weak = model.nodes.filter((n) => n.state === "weak").sort((a, b) => b.error_count - a.error_count || a.name.localeCompare(b.name));
  const learning = model.nodes.filter((n) => n.state === "learning" || (n.state === "mastered" && n.root_rank === undefined));
  const openRoots = model.roots.filter((r) => !r.mastered);
  return (
    <>
      <section aria-labelledby="cp-roots">
        <h2 id="cp-roots" className={styles.h2}>
          {model.roots.length === 1 ? "Your root" : "Your roots"}
        </h2>
        {model.roots.length === 0 ? (
          <p className={styles.muted}>
            No single gap sits under your mistakes. They look like checking habits, so the map has no root to fix: every star here is
            either fine or not assessed yet.
          </p>
        ) : (
          <ol className={styles.rootList} role="list">
            {model.roots.map((r) => {
              const n = byId.get(r.id);
              return (
                <li key={r.id}>
                  <button type="button" className={styles.rootButton} onClick={() => onSelect(r.id)}>
                    <span className={`${styles.rank} ${r.mastered ? styles.rankDone : ""}`} aria-hidden="true">
                      {r.mastered ? <Icon name="check" size={14} /> : r.rank}
                    </span>
                    <span className={styles.rootText}>
                      <span className={styles.rootName}>{r.name}</span>
                      <span className={styles.rootMeta}>
                        {r.mastered
                          ? `Mastered · ${plural(r.downstream_count, "topic")} built on it lit up`
                          : `Explains ${plural(r.error_count, "mistake")} · ~${marks(r.marks_lost)} marks · ${plural(r.downstream_count, "topic")} build on it`}
                      </span>
                    </span>
                    <span className="visually-hidden">{n ? `, ${STATE_LABEL[n.state]}` : ""}</span>
                    <Icon name="arrowRight" size={16} className={styles.chev} />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {demo.enabled && model.roots.length > 0 && (
        <section className={styles.demo} aria-labelledby="cp-demo">
          <h2 id="cp-demo" className={styles.h3}>
            <span className={styles.demoTag}>Demo</span> The chain reaction
          </h2>
          <p className={styles.muted}>
            Pretend you passed the &ldquo;prove it&rdquo; check on a root. This writes it to the database as mastered, the way a finished
            mission will, and the map lights up everything built on it.
          </p>
          <div className={styles.demoButtons}>
            {openRoots.map((r) => (
              <button key={r.id} type="button" className={styles.demoButton} disabled={demo.pending} onClick={() => demo.onMaster(r.id)}>
                <Icon name="spark" size={16} />
                Master {r.name}
              </button>
            ))}
            {openRoots.length < model.roots.length && (
              <button type="button" className={styles.resetButton} disabled={demo.pending} onClick={demo.onReset}>
                <Icon name="repeat" size={16} />
                Reset demo
              </button>
            )}
          </div>
        </section>
      )}

      {weak.length > 0 && (
        <section aria-labelledby="cp-weak">
          <h2 id="cp-weak" className={styles.h3}>
            Topics with mistakes
          </h2>
          <ul className={styles.nodeList} role="list">
            {weak.map((n) => (
              <li key={n.id}>
                <NodeButton node={n} onSelect={onSelect} meta={plural(n.error_count, "mistake")} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {learning.length > 0 && (
        <section aria-labelledby="cp-learning">
          <h2 id="cp-learning" className={styles.h3}>
            Recovering
          </h2>
          <ul className={styles.nodeList} role="list">
            {learning.map((n) => (
              <li key={n.id}>
                <NodeButton node={n} onSelect={onSelect} meta={STATE_LABEL[n.state]} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="cp-read">
        <h2 id="cp-read" className={styles.h3}>
          How to read the map
        </h2>
        <Legend counts={model.counts} />
        <p className={styles.muted}>
          Each star is a topic. Class 9–10 foundations sit at the centre, Class 11 around them and Class 12 at the rim, so threads of light
          run outwards from a topic to what is built on it. Each coloured wedge is one unit of the syllabus.
        </p>
      </section>
    </>
  );
}

function ConceptDetail({ model, node, onSelect }: { model: ConstellationModel; node: ConstellationNode; onSelect(id: string | null): void }) {
  const unit = model.units.find((u) => u.id === node.unit_id);
  const root = model.roots.find((r) => r.id === node.id);
  const tracedTo = node.root_ids.filter((r) => r !== node.id).map((r) => model.roots.find((x) => x.id === r)!).filter(Boolean);
  const recordIds = root ? [...new Set([...root.record_ids, ...node.record_ids])] : node.record_ids;
  const evidence = recordIds.map((id) => model.evidence[id]).filter((e) => e !== undefined);
  const prereqs = node.prerequisites.map((i) => model.nodes[i]!);
  const deps = node.dependents.map((i) => model.nodes[i]!);

  return (
    <article aria-labelledby="cp-title" className={styles.detail}>
      <button type="button" className={styles.back} onClick={() => onSelect(null)}>
        <Icon name="arrowLeft" size={16} />
        All roots
      </button>
      <p className={styles.state}>
        <StateDot state={node.state} />
        {root && node.state === "root" ? `Root gap ${root.rank}` : STATE_LABEL[node.state]}
        {node.lit && node.state !== "mastered" && <span className={styles.litTag}>lit by a fixed root</span>}
      </p>
      <h2 id="cp-title" className={styles.title}>
        {node.name}
      </h2>
      <p className={styles.meta}>
        {node.subject} · {unit?.name ?? node.chapter} · Class {node.class}
      </p>

      {root && (
        <>
          <p className={styles.explain}>{root.explanation}</p>
          <dl className={styles.stats}>
            <div>
              <dt>Mistakes it explains</dt>
              <dd className="tabular">{root.error_count}</dd>
            </div>
            <div>
              <dt>Marks behind them</dt>
              <dd className="tabular">
                {root.marks_estimated ? "~" : ""}
                {marks(root.marks_lost)}
              </dd>
            </div>
            <div>
              <dt>Topics it lights up</dt>
              <dd className="tabular">{root.downstream_count}</dd>
            </div>
          </dl>
        </>
      )}

      {tracedTo.length > 0 && (
        <section aria-labelledby="cp-traced">
          <h3 id="cp-traced" className={styles.h3}>
            Traced back to
          </h3>
          <ul className={styles.nodeList} role="list">
            {tracedTo.map((r) => (
              <li key={r.id}>
                <NodeButton node={model.nodes.find((n) => n.id === r.id)!} onSelect={onSelect} meta={r.mastered ? "Mastered" : `Root gap ${r.rank}`} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="cp-evidence">
        <h3 id="cp-evidence" className={styles.h3}>
          {root ? "The mistakes, in your report's words" : "From your report"}
        </h3>
        {evidence.length === 0 ? (
          <p className={styles.muted}>Your reports don&apos;t mention this topic yet.</p>
        ) : (
          <ul className={styles.evidence} role="list">
            {evidence.map((e) => (
              <li key={e.record_id}>
                <p className={styles.evMeta}>
                  {e.exam_name} · {e.question_ref}
                  {e.marks_lost !== undefined && ` · ${plural(e.marks_lost, "mark")} lost`}
                </p>
                <blockquote className={styles.quote}>{e.diagnosis}</blockquote>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cp-why">
        <h3 id="cp-why" className={styles.h3}>
          Why it matters
        </h3>
        <p className={styles.muted}>
          {node.downstream_count === 0
            ? "Nothing else in the syllabus builds on this topic, so a gap here stays here."
            : `${plural(node.downstream_count, "topic")} build on this one${node.board_marks_dependent > 0 ? `, carrying about ${marks(node.board_marks_dependent)} board-exam marks` : ""}. A gap here shows up in all of them.`}
        </p>
        {prereqs.length > 0 && (
          <>
            <h4 className={styles.h4}>Built on</h4>
            <ul className={styles.chips} role="list">
              {prereqs.map((n) => (
                <li key={n.id}>
                  <NodeButton node={n} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          </>
        )}
        {deps.length > 0 && (
          <>
            <h4 className={styles.h4}>Leads to</h4>
            <ul className={styles.chips} role="list">
              {deps.slice(0, 10).map((n) => (
                <li key={n.id}>
                  <NodeButton node={n} onSelect={onSelect} />
                </li>
              ))}
            </ul>
            {deps.length > 10 && <p className={styles.muted}>and {deps.length - 10} more</p>}
          </>
        )}
      </section>
    </article>
  );
}
