import { buildConceptGraph, ErrorRecordSchema, type ConceptGraph, type ErrorRecord, type ErrorType } from "../../src";

/** Random valid concept graphs and planted students for the scale test. Seeded, so reproducible. */

const SUBJECTS = 3;
/** 200 concepts per subject, Class 9 to 12. */
const CLASS_BANDS = [
  { cls: 9, n: 30 },
  { cls: 10, n: 30 },
  { cls: 11, n: 70 },
  { cls: 12, n: 70 },
];

export function randomGraph(rand: () => number): ConceptGraph {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const files = [];
  const all: { id: string; subject: number; idx: number }[][] = [];
  for (let s = 0; s < SUBJECTS; s++) {
    const units = Array.from({ length: 8 }, (_, u) => ({
      id: `g${s}.u${u}`,
      name: `Unit ${u}`,
      class: u < 2 ? 10 : u < 5 ? 11 : 12,
      board_marks: u < 2 ? 0 : 4 + Math.floor(rand() * 12),
    }));
    const concepts = [];
    const ids: { id: string; subject: number; idx: number }[] = [];
    let i = 0;
    for (const band of CLASS_BANDS) {
      for (let k = 0; k < band.n; k++, i++) {
        const id = `g${s}.c${i}`;
        const prereqs = new Set<string>();
        if (i > 0) {
          const n = 1 + Math.floor(rand() * 3);
          for (let t = 0; t < n; t++) {
            // Prefer recent concepts so chains get deep, but reach back sometimes.
            const back = rand() < 0.7 ? Math.min(i, 1 + Math.floor(rand() * 25)) : 1 + Math.floor(rand() * i);
            prereqs.add(`g${s}.c${i - back}`);
          }
          if (s > 0 && rand() < 0.05) prereqs.add(pick(all[s - 1]!.slice(0, 100)).id); // cross-subject edge
        }
        const unit = band.cls <= 10 ? Math.floor(rand() * 2) : band.cls === 11 ? 2 + Math.floor(rand() * 3) : 5 + Math.floor(rand() * 3);
        concepts.push({
          id,
          name: `Topic ${s}-${i}`,
          class: band.cls,
          unit_id: `g${s}.u${unit}`,
          chapter: "ch",
          prerequisites: [...prereqs],
          aliases: [],
          misconceptions: [],
        });
        ids.push({ id, subject: s, idx: i });
      }
    }
    all.push(ids);
    files.push({ name: `g${s}.json`, text: JSON.stringify({ subject: `Subject ${s}`, syllabus_source: "random", units, concepts }) });
  }
  return buildConceptGraph(files).graph;
}

interface Scenario {
  records: ErrorRecord[];
  planted: string[];
}

/** `total`, if given, tops noise up so the student has that many records whatever could be planted. */
export function plantStudent(
  graph: ConceptGraph,
  rand: () => number,
  nRoots: number,
  errorsPerRoot: number,
  noise: number,
  slips: number,
  total?: number,
): Scenario {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const concepts = [...graph.concepts.keys()].sort();
  const exams = [
    { id: "x.ut", date: "2026-07-15" },
    { id: "x.hy", date: "2026-09-20" },
    { id: "x.pb", date: "2026-11-10" },
  ];
  // Planted roots are unrelated: neither is an ancestor of the other and they share no
  // descendants, so the right answer is unambiguous.
  const planted: string[] = [];
  const claimed = new Set<string>();
  for (let tries = 0; planted.length < nRoots && tries < 5000; tries++) {
    const r = pick(concepts);
    if (graph.get(r).class < 10 || graph.dependentsOf(r).length < errorsPerRoot || graph.depthOf(r) < 2) continue;
    const below = new Set([r, ...graph.descendantsOf(r)]);
    const family = new Set([...below, ...graph.ancestorsOf(r)]);
    if ([...below].some((c) => claimed.has(c)) || planted.some((p) => family.has(p))) continue;
    planted.push(r);
    for (const c of family) claimed.add(c);
  }
  const plantedFamily = claimed;
  const records: ErrorRecord[] = [];
  let q = 0;
  const make = (concept: string, type: ErrorType, secondary?: string): ErrorRecord => {
    const exam = pick(exams);
    const id = `x.${++q}`;
    return ErrorRecordSchema.parse({
      schema_version: "1.0",
      id,
      student: { id: "x.student" },
      exam: { id: exam.id, name: exam.id, date: exam.date, subject: graph.get(concept).subject },
      question: { ref: `Q${q}` },
      diagnosis: { text: "random" },
      error_type: type,
      ...(rand() < 0.75 ? { marks: { lost: 1 + Math.floor(rand() * 4) } } : {}),
      concepts: [
        { concept_id: concept, confidence: 0.6 + rand() * 0.35, role: "primary", mapped_by: "manual" },
        ...(secondary ? [{ concept_id: secondary, confidence: 0.5 + rand() * 0.3, role: "secondary", mapped_by: "manual" }] : []),
      ],
      provenance: { kind: "demo_fixture", fixture_file: "scale-test", sample_data: true },
    });
  };

  for (const r of planted) {
    // One error per branch: each in a different child of the root, or in a grandchild
    // reached only through that child, so the root (not a child) is the lowest shared cause.
    const children = [...graph.dependentsOf(r)].sort();
    const childSet = new Set(children);
    const branches = children.slice().sort(() => rand() - 0.5).slice(0, errorsPerRoot);
    for (const child of branches) {
      const grand = graph
        .dependentsOf(child)
        .filter((g) => !childSet.has(g) && graph.prerequisitesOf(g).filter((p) => childSet.has(p)).length === 1)
        .sort();
      const anchor = rand() < 0.4 && grand.length > 0 ? pick(grand) : child;
      records.push(make(anchor, rand() < 0.7 ? "conceptual" : "procedural", rand() < 0.35 ? r : undefined));
    }
  }
  const free = concepts.filter((c) => !plantedFamily.has(c));
  const noiseCount = total !== undefined ? Math.max(noise, total - records.length - slips) : noise;
  for (let k = 0; k < noiseCount; k++) records.push(make(pick(free), rand() < 0.7 ? "conceptual" : "procedural"));
  for (let k = 0; k < slips; k++) records.push(make(pick(concepts), pick(["careless", "calculation", "notation"] as const)));
  return { records, planted };
}

