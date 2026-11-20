import { z } from "zod";
import { IsoDate } from "./error-record/schema";

/** A student, identified only by a pseudonymous id. display_name is local-only and never sent to an LLM. */
export const StudentSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._:-]+$/),
    display_name: z.string().min(1),
    class: z.union([z.literal(11), z.literal(12)]),
    subjects: z.array(z.string().min(1)).min(1),
    /** The exam the student is preparing for next; drives the plan's deadline. */
    next_exam: z.object({ name: z.string().min(1), date: IsoDate }).strict().optional(),
  })
  .strict();
export type Student = z.infer<typeof StudentSchema>;

export const ExamSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._:-]+$/),
    student_id: z.string(),
    name: z.string().min(1),
    date: IsoDate,
    subject: z.string().min(1),
    max_marks: z.number().positive().optional(),
  })
  .strict();
export type Exam = z.infer<typeof ExamSchema>;
