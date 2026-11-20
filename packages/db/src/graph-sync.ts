import type { ConceptGraph } from "@progresso/core";
import type { Db } from "./client";
import { conceptPrerequisites, concepts, graphVersions, misconceptions, units } from "./schema";

/**
 * Replace the DB's concept tables with the given graph. The graph files stay
 * the source of truth; these tables are a queryable cache. Error-record
 * mappings are untouched (they are soft references).
 */
export function syncConceptGraph(db: Db, graph: ConceptGraph): void {
  db.transaction((tx) => {
    tx.delete(misconceptions).run();
    tx.delete(conceptPrerequisites).run();
    tx.delete(concepts).run();
    tx.delete(units).run();

    for (const u of graph.units.values()) {
      tx.insert(units).values({ id: u.id, subject: u.subject, name: u.name, class: u.class, boardMarks: u.board_marks }).run();
    }
    for (const c of graph.concepts.values()) {
      tx.insert(concepts)
        .values({
          id: c.id,
          subject: c.subject,
          name: c.name,
          class: c.class,
          unitId: c.unit_id,
          chapter: c.chapter,
          aliases: c.aliases,
          graphFingerprint: graph.fingerprint,
        })
        .run();
    }
    for (const c of graph.concepts.values()) {
      for (const p of c.prerequisites) tx.insert(conceptPrerequisites).values({ conceptId: c.id, prerequisiteId: p }).run();
      for (const m of c.misconceptions) {
        tx.insert(misconceptions).values({ id: m.id, conceptId: c.id, description: m.description }).run();
      }
    }
    tx.insert(graphVersions)
      .values({ fingerprint: graph.fingerprint, sourceDir: graph.sourceDir, stats: graph.stats() })
      .onConflictDoNothing()
      .run();
  });
}
