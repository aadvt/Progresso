import type { Concept, Misconception, Unit } from "./schema";

export interface SubjectStats {
  subject: string;
  units: number;
  concepts: number;
  prerequisiteEdges: number;
  misconceptions: number;
  /** Concepts with no prerequisites. */
  roots: number;
  /** Concepts nothing depends on. */
  leaves: number;
  /** Longest prerequisite chain, counted in edges (a root has depth 0). */
  maxDepth: number;
  /** Concepts per class, e.g. { 10: 9, 11: 20, 12: 30 }. */
  byClass: Record<number, number>;
}

export interface GraphStats {
  fingerprint: string;
  sourceDir: string;
  subjects: SubjectStats[];
  totals: { concepts: number; edges: number; crossSubjectEdges: number; misconceptions: number };
  deepestChain: string[];
}

/**
 * Immutable, validated prerequisite graph. Edges point from a concept to the
 * concepts it depends on. Construct with loadConceptGraph(); this class
 * assumes validation (unique ids, no dangling ids, acyclic) already passed.
 */
export class ConceptGraph {
  readonly concepts: ReadonlyMap<string, Concept>;
  readonly units: ReadonlyMap<string, Unit & { subject: string }>;
  readonly misconceptions: ReadonlyMap<string, Misconception & { concept_id: string }>;
  readonly subjects: readonly string[];
  private readonly dependents = new Map<string, string[]>();
  private readonly depthCache = new Map<string, number>();

  constructor(
    concepts: Concept[],
    units: (Unit & { subject: string })[],
    readonly fingerprint: string,
    readonly sourceDir: string,
  ) {
    this.concepts = new Map(concepts.map((c) => [c.id, c]));
    this.units = new Map(units.map((u) => [u.id, u]));
    this.subjects = [...new Set([...concepts, ...units].map((x) => x.subject))].sort();
    const misconceptions = new Map<string, Misconception & { concept_id: string }>();
    for (const c of concepts) {
      if (!this.dependents.has(c.id)) this.dependents.set(c.id, []);
      for (const p of c.prerequisites) {
        const list = this.dependents.get(p) ?? [];
        list.push(c.id);
        this.dependents.set(p, list);
      }
      for (const m of c.misconceptions) misconceptions.set(m.id, { ...m, concept_id: c.id });
    }
    this.misconceptions = misconceptions;
  }

  has(id: string): boolean {
    return this.concepts.has(id);
  }

  get(id: string): Concept {
    const c = this.concepts.get(id);
    if (!c) throw new Error(`Unknown concept id: ${id}`);
    return c;
  }

  prerequisitesOf(id: string): readonly string[] {
    return this.get(id).prerequisites;
  }

  dependentsOf(id: string): readonly string[] {
    return this.dependents.get(id) ?? [];
  }

  /** All transitive prerequisites of `id` (not including itself). */
  ancestorsOf(id: string): Set<string> {
    return this.walk(id, (n) => this.prerequisitesOf(n));
  }

  /** All concepts that transitively depend on `id` (not including itself). */
  descendantsOf(id: string): Set<string> {
    return this.walk(id, (n) => this.dependentsOf(n));
  }

  /** Longest prerequisite chain below `id`, in edges. */
  depthOf(id: string): number {
    const cached = this.depthCache.get(id);
    if (cached !== undefined) return cached;
    const prereqs = this.prerequisitesOf(id);
    const depth = prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map((p) => this.depthOf(p)));
    this.depthCache.set(id, depth);
    return depth;
  }

  /** One longest chain ending at `id`, root first. */
  deepestChainTo(id: string): string[] {
    const prereqs = this.prerequisitesOf(id);
    if (prereqs.length === 0) return [id];
    const deepest = prereqs.reduce((a, b) => (this.depthOf(b) > this.depthOf(a) ? b : a));
    return [...this.deepestChainTo(deepest), id];
  }

  roots(subject?: string): Concept[] {
    return this.list(subject).filter((c) => c.prerequisites.length === 0);
  }

  list(subject?: string): Concept[] {
    const all = [...this.concepts.values()];
    return subject ? all.filter((c) => c.subject === subject) : all;
  }

  /** Concepts ordered so every prerequisite comes before its dependents. */
  topologicalOrder(): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const p of this.prerequisitesOf(id)) visit(p);
      order.push(id);
    };
    for (const id of [...this.concepts.keys()].sort()) visit(id);
    return order;
  }

  /** Find a concept by exact id, name or alias (case-insensitive). */
  findByName(text: string): Concept | undefined {
    const needle = text.trim().toLowerCase();
    for (const c of this.concepts.values()) {
      if (c.id === needle || c.name.toLowerCase() === needle) return c;
      if (c.aliases.some((a) => a.toLowerCase() === needle)) return c;
    }
    return undefined;
  }

  stats(): GraphStats {
    const subjects = this.subjects.map((subject): SubjectStats => {
      const concepts = this.list(subject);
      const byClass: Record<number, number> = {};
      for (const c of concepts) byClass[c.class] = (byClass[c.class] ?? 0) + 1;
      return {
        subject,
        units: [...this.units.values()].filter((u) => u.subject === subject).length,
        concepts: concepts.length,
        prerequisiteEdges: concepts.reduce((n, c) => n + c.prerequisites.length, 0),
        misconceptions: concepts.reduce((n, c) => n + c.misconceptions.length, 0),
        roots: concepts.filter((c) => c.prerequisites.length === 0).length,
        leaves: concepts.filter((c) => this.dependentsOf(c.id).length === 0).length,
        maxDepth: Math.max(0, ...concepts.map((c) => this.depthOf(c.id))),
        byClass,
      };
    });
    const all = this.list();
    let deepest: Concept | undefined;
    for (const c of all) if (!deepest || this.depthOf(c.id) > this.depthOf(deepest.id)) deepest = c;
    return {
      fingerprint: this.fingerprint,
      sourceDir: this.sourceDir,
      subjects,
      totals: {
        concepts: all.length,
        edges: subjects.reduce((n, s) => n + s.prerequisiteEdges, 0),
        crossSubjectEdges: all.reduce(
          (n, c) => n + c.prerequisites.filter((p) => this.get(p).subject !== c.subject).length,
          0,
        ),
        misconceptions: this.misconceptions.size,
      },
      deepestChain: deepest ? this.deepestChainTo(deepest.id) : [],
    };
  }

  private walk(start: string, next: (id: string) => readonly string[]): Set<string> {
    const out = new Set<string>();
    const stack = [...next(start)];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...next(id));
    }
    return out;
  }
}
