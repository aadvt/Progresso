import { z } from "zod";

/**
 * On-disk concept-graph format. One JSON file per subject. The provisional
 * graph and the full Phase P graph share this exact format, so the schema is
 * strict: unknown keys are rejected to catch typos such as "prerequisite".
 */

const GraphId = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/, "ids are lowercase, dot-separated, no spaces");

export const UnitSchema = z
  .object({
    id: GraphId,
    name: z.string().min(1),
    class: z.number().int().min(1).max(12),
    board_marks: z.number().min(0),
  })
  .strict();

export const MisconceptionSchema = z
  .object({
    id: GraphId,
    description: z.string().min(1),
  })
  .strict();

export const ConceptSchema = z
  .object({
    id: GraphId,
    name: z.string().min(1),
    class: z.number().int().min(1).max(12),
    unit_id: GraphId,
    chapter: z.string().min(1),
    prerequisites: z.array(GraphId),
    aliases: z.array(z.string().min(1)),
    misconceptions: z.array(MisconceptionSchema),
  })
  .strict();

export const GraphFileSchema = z
  .object({
    subject: z.string().min(1),
    syllabus_source: z.string().min(1),
    units: z.array(UnitSchema),
    concepts: z.array(ConceptSchema),
  })
  .strict();

export type Unit = z.infer<typeof UnitSchema>;
export type Misconception = z.infer<typeof MisconceptionSchema>;
export type ConceptDef = z.infer<typeof ConceptSchema>;
export type GraphFile = z.infer<typeof GraphFileSchema>;

/** A concept as held in memory: the file definition plus its subject. */
export interface Concept extends ConceptDef {
  subject: string;
}
