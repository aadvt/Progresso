import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConceptGraph } from "./graph";
import { GraphFileSchema, type Concept, type GraphFile } from "./schema";

export interface GraphIssue {
  file?: string;
  id?: string;
  message: string;
}

export class GraphValidationError extends Error {
  constructor(
    readonly errors: GraphIssue[],
    readonly warnings: GraphIssue[] = [],
  ) {
    super(
      `Concept graph is invalid (${errors.length} error${errors.length === 1 ? "" : "s"}):\n` +
        errors.map((e) => `  - ${formatIssue(e)}`).join("\n"),
    );
    this.name = "GraphValidationError";
  }
}

export function formatIssue(e: GraphIssue): string {
  return `${e.file ? `[${e.file}] ` : ""}${e.id ? `${e.id}: ` : ""}${e.message}`;
}

export interface LoadedGraph {
  graph: ConceptGraph;
  warnings: GraphIssue[];
}

/** Read every *.json file in `dir` and build a validated graph. Throws GraphValidationError. */
export function loadConceptGraph(dir: string): LoadedGraph {
  if (!existsSync(dir)) throw new GraphValidationError([{ message: `graph directory not found: ${dir}` }]);
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (names.length === 0) throw new GraphValidationError([{ message: `no .json graph files in ${dir}` }]);
  const raw = names.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
  return buildConceptGraph(raw, dir);
}

/** Validate and build from already-read file contents (also used by tests). */
export function buildConceptGraph(files: { name: string; text: string }[], sourceDir = "<memory>"): LoadedGraph {
  const errors: GraphIssue[] = [];
  const warnings: GraphIssue[] = [];
  const parsed: { name: string; data: GraphFile }[] = [];

  for (const f of files) {
    let json: unknown;
    try {
      json = JSON.parse(f.text);
    } catch (e) {
      errors.push({ file: f.name, message: `invalid JSON: ${(e as Error).message}` });
      continue;
    }
    const result = GraphFileSchema.safeParse(json);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({ file: f.name, message: `${issue.path.join(".") || "<root>"}: ${issue.message}` });
      }
      continue;
    }
    parsed.push({ name: f.name, data: result.data });
  }
  if (errors.length > 0) throw new GraphValidationError(errors, warnings);

  errors.push(...checkStructure(parsed, warnings));
  if (errors.length > 0) throw new GraphValidationError(errors, warnings);

  const concepts: Concept[] = parsed.flatMap((p) => p.data.concepts.map((c) => ({ ...c, subject: p.data.subject })));
  const units = parsed.flatMap((p) => p.data.units.map((u) => ({ ...u, subject: p.data.subject })));
  const graph = new ConceptGraph(concepts, units, fingerprint(parsed.map((p) => p.data)), sourceDir);
  return { graph, warnings };
}

function checkStructure(files: { name: string; data: GraphFile }[], warnings: GraphIssue[]): GraphIssue[] {
  const errors: GraphIssue[] = [];
  // One id namespace across units, concepts and misconceptions, across all files.
  const owner = new Map<string, string>();
  const claim = (id: string, file: string, kind: string): void => {
    const prev = owner.get(id);
    if (prev) errors.push({ file, id, message: `duplicate ${kind} id (also defined in ${prev})` });
    else owner.set(id, file);
  };

  const subjects = new Map<string, string>();
  const unitIds = new Set<string>();
  const conceptIds = new Set<string>();
  for (const { name, data } of files) {
    const prev = subjects.get(data.subject);
    if (prev) errors.push({ file: name, message: `subject "${data.subject}" is also defined in ${prev}` });
    subjects.set(data.subject, name);
    for (const u of data.units) {
      claim(u.id, name, "unit");
      unitIds.add(u.id);
    }
    for (const c of data.concepts) {
      claim(c.id, name, "concept");
      conceptIds.add(c.id);
      for (const m of c.misconceptions) {
        claim(m.id, name, "misconception");
        if (!m.id.startsWith(`${c.id}.`)) {
          warnings.push({ file: name, id: m.id, message: `misconception id does not start with "${c.id}."` });
        }
      }
    }
  }

  const prereqs = new Map<string, readonly string[]>();
  for (const { name, data } of files) {
    const localUnits = new Set(data.units.map((u) => u.id));
    for (const c of data.concepts) {
      prereqs.set(c.id, c.prerequisites);
      if (!localUnits.has(c.unit_id)) {
        errors.push({
          file: name,
          id: c.id,
          message: unitIds.has(c.unit_id)
            ? `unit_id "${c.unit_id}" belongs to another subject`
            : `unknown unit_id "${c.unit_id}"`,
        });
      }
      const seen = new Set<string>();
      for (const p of c.prerequisites) {
        if (p === c.id) errors.push({ file: name, id: c.id, message: "concept lists itself as a prerequisite" });
        else if (!conceptIds.has(p)) errors.push({ file: name, id: c.id, message: `missing prerequisite id "${p}"` });
        if (seen.has(p)) errors.push({ file: name, id: c.id, message: `prerequisite "${p}" listed twice` });
        seen.add(p);
      }
    }
    for (const u of data.units) {
      if (!data.concepts.some((c) => c.unit_id === u.id)) {
        warnings.push({ file: name, id: u.id, message: "unit has no concepts" });
      }
    }
  }
  // Runs even when other errors exist (dangling ids are skipped), so one pass reports every problem.
  for (const cycle of findCycles(prereqs)) {
    errors.push({ id: cycle[0], message: `prerequisite cycle: ${cycle.join(" -> ")}` });
  }
  return errors;
}

/** Iterative DFS over prerequisite edges; returns each cycle found as a closed path. */
function findCycles(prereqs: Map<string, readonly string[]>): string[][] {
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const cycles: string[][] = [];
  for (const start of [...prereqs.keys()].sort()) {
    if (state.has(start)) continue;
    const path: string[] = [start];
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, VISITING);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const children = prereqs.get(top.id) ?? [];
      if (top.next < children.length) {
        const child = children[top.next++]!;
        const s = state.get(child);
        if (s === VISITING) cycles.push([...path.slice(path.indexOf(child)), child]);
        else if (s === undefined) {
          state.set(child, VISITING);
          path.push(child);
          stack.push({ id: child, next: 0 });
        }
      } else {
        state.set(top.id, DONE);
        path.pop();
        stack.pop();
      }
    }
  }
  return cycles;
}

/** Content hash of the graph, so concept mappings can record which graph version they used. */
function fingerprint(files: GraphFile[]): string {
  const canonical = JSON.stringify([...files].sort((a, b) => a.subject.localeCompare(b.subject)));
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}
