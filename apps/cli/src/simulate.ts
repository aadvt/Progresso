/**
 * Simulate a student working through their comeback plan, day by day, using
 * the real mission service on a throwaway database. Shows how the plan,
 * mastery, constellation and readiness evolve.
 *
 *   pnpm simulate                       demo-riya, 14 days, scripted answers
 *   pnpm simulate demo-kabir --days 14 --minutes 50
 *   pnpm simulate demo-riya --out docs/phase-5-simulation.md
 *
 * Answers: a seeded mix of right and wrong. A wrong answer picks the option
 * built from one of the student's own misconceptions when there is one (the
 * old mistake coming back), else another misconception's option. Day 4 is
 * skipped entirely, to show the plan re-flowing.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addDays,
  analyseStudent,
  buildConstellation,
  findRepoRoot,
  layoutConstellation,
  loadAppConfig,
  loadConceptGraph,
  loadQuestionBank,
  type ProveItQuestion,
} from "@progresso/core";
import { loadDemoFixtures } from "@progresso/core/demo-fixtures";
import {
  answerQuestion,
  ensureDemoData,
  finishMission,
  getConceptMastery,
  getMission,
  getPlan,
  getReadiness,
  openDb,
  ownMisconceptions,
  runMigrations,
  savePlanSettings,
  startMission,
  type StudentContext,
} from "@progresso/db";

const args = process.argv.slice(2);
const value = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : d;
};
const studentId = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--")) ?? "demo-riya";
const days = Number(value("days", "14"));
const minutes = Number(value("minutes", "25"));
const start = value("start", "2026-11-21");
const skipDays = new Set(value("skip", "4").split(",").map(Number));
const out = value("out", "");

const repoRoot = findRepoRoot();
const config = loadAppConfig(repoRoot);
const { graph } = loadConceptGraph(config.conceptGraphDir);
const demo = loadDemoFixtures(config.fixturesDir);
const s = demo.find((d) => d.student.id === studentId);
if (!s) throw new Error(`unknown student ${studentId}`);
const bank = loadQuestionBank(config.questionBankDir, graph);
const { db, close } = openDb(":memory:");
runMigrations(db);
ensureDemoData(db, demo, graph);
const analysis = { ...analyseStudent({ graph, records: s.records }), student_id: studentId };
const ctx: StudentContext = { student_id: studentId, graph, analysis, records: s.records, bank };
const exam = s.student.next_exam!;
savePlanSettings(db, studentId, { exam_name: exam.name, exam_date: exam.date, daily_minutes: minutes, start_date: start });
const layout = layoutConstellation(graph, s.student.subjects);
const own = new Set(ownMisconceptions(s.records));

// Deterministic "student": right ~70% of the time, with scripted days.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
/** Day index → how this day goes. "own": one answer brings back the report's mistake. */
const script: Record<number, "own" | "strong" | "weak" | undefined> = { 1: "own", 2: "strong", 5: "weak" };

function pick(q: ProveItQuestion, correct: boolean, preferOwn: boolean): string {
  if (q.kind === "mcq") {
    if (correct) return q.options!.find((o) => o.correct)!.id;
    const wrong = q.options!.filter((o) => !o.correct);
    return (preferOwn ? wrong.find((o) => own.has(o.misconception_id!)) : undefined)?.id ?? wrong[Math.floor(rand() * wrong.length)]!.id;
  }
  if (correct) return String(q.answer!.value);
  const w = q.numeric_wrong ?? [];
  const chosen = (preferOwn ? w.find((x) => own.has(x.misconception_id)) : undefined) ?? w[0];
  return String(chosen ? chosen.value : q.answer!.value + 7);
}

const name = (id?: string) => (id && graph.has(id) ? graph.get(id).name : (id ?? ""));
const lines: string[] = [];
const log = (l = "") => {
  lines.push(l);
  console.log(l);
};
const pct = (r: { low: number; mid: number; high: number }) => `${Math.round(r.low)}–${Math.round(r.high)}% (mid ${r.mid.toFixed(1)})`;

log(`# Simulation: ${s.student.display_name.replace(" (sample)", "")} (${studentId}, SAMPLE DATA), ${days} days at ${minutes} min/day`);
log();
log(`Start ${start}, ${exam.name} on ${exam.date}. Roots: ${analysis.roots.map((r) => `${r.concept.name} (#${r.rank})`).join(", ") || "none"}. Questions in the bank: ${bank.questions.length}.`);
log(`Answer policy: seeded, ~70% right; day 1 brings back the report's own mistake once; day 2 all right; day 5 mostly wrong; day${skipDays.size > 1 ? "s" : ""} ${[...skipDays].join(", ")} skipped.`);
log();

const rows: string[] = [];
for (let d = 1; d <= days; d++) {
  const today = addDays(start, d - 1);
  log(`## Day ${d} · ${today}${skipDays.has(d) ? " · SKIPPED" : ""}`);
  const plan = getPlan(db, ctx, today)!;
  const todays = plan.days.find((x) => x.date === today)?.missions.filter((m) => m.status === "today") ?? [];
  const results: string[] = [];
  if (skipDays.has(d)) {
    log(`Planned but not done: ${todays.map((m) => m.key).join(", ") || "nothing"}`);
    // The student opens nothing today; tomorrow's plan simply starts from where they are.
  } else {
    for (const m of todays) {
      const id = startMission(db, ctx, today, m.key)!;
      const view = getMission(db, ctx, id)!;
      const mode = script[d];
      view.questions.forEach((q, i) => {
        let correct = rand() < 0.72;
        let preferOwn = false;
        if (mode === "own") {
          correct = i !== 1;
          preferOwn = true;
        } else if (mode === "strong") correct = true;
        else if (mode === "weak") correct = i === 0;
        const given = pick(q.question, correct, preferOwn || rand() < 0.5);
        answerQuestion(db, ctx, id, q.question.id, given, `${today}T17:${String(10 + i).padStart(2, "0")}:00Z`);
      });
      const r = finishMission(db, ctx, id, `${today}T17:30:00Z`);
      if (typeof r === "string") throw new Error(r);
      const desc = r.outcomes
        .map((o) => `${name(o.concept_id)}: ${o.outcome.correct}/${o.outcome.total} ${o.outcome.passed ? "PASS" : "not yet"} (${o.before} → ${o.after})${o.outcome.revealed.length ? `; revealed ${o.outcome.revealed.join(", ")}` : ""}${o.root_mastered ? " ★ ROOT MASTERED: ripple" : ""}`)
        .join("; ");
      results.push(`${m.kind} ${m.key}`);
      log(`- **${m.kind}** \`${m.key}\` (${view.questions.length} questions): ${desc}`);
    }
  }
  // State at the end of the day.
  const after = getPlan(db, ctx, addDays(today, 1))!;
  const mastery = getConceptMastery(db, studentId);
  const model = buildConstellation({ student_id: studentId, graph, layout, analysis, records: s.records, mastery });
  const targeted = [...new Set(after.days.flatMap((x) => x.missions.map((m) => m.concept_id)).filter((c): c is string => !!c))];
  const readiness = getReadiness(db, ctx, exam.date, targeted);
  const c = model.counts;
  const next = after.days.find((x) => x.date === addDays(today, 1))?.missions.map((m) => m.key).join(", ") || "rest";
  log(
    `End of day: plan ${after.totals.learning_done} learning missions done, ${after.totals.learning_remaining} to go, new topics done by ${after.totals.projected_finish ?? "—"}, ${after.totals.reviews_planned} reviews ahead; ` +
      `topics proven ${after.totals.concepts_proven}/${after.totals.concepts_targeted}.`,
  );
  log(`Mastery: ${mastery.map((m) => `${name(m.concept_id)}=${m.state}`).join(", ") || "none yet"}.`);
  log(`Constellation: root ${c.root}, weak ${c.weak}, learning ${c.learning}, mastered ${c.mastered}, lit ${model.nodes.filter((n) => n.lit).length}. Readiness now ${pct(readiness.now)}. Tomorrow: ${next}.`);
  log();
  rows.push(
    `| ${d} | ${today} | ${skipDays.has(d) ? "_skipped_" : results.join("<br>") || "rest"} | ${after.totals.learning_done}/${after.totals.learning_done + after.totals.learning_remaining + after.unscheduled.length} | ${after.totals.projected_finish ?? "—"} | ${after.totals.concepts_proven}/${after.totals.concepts_targeted} | ${c.root}/${c.weak}/${c.learning}/${c.mastered} · lit ${model.nodes.filter((n) => n.lit).length} | ${Math.round(readiness.now.low)}–${Math.round(readiness.now.high)} (${readiness.now.mid.toFixed(1)}) |`,
  );
}

log("## Summary");
log();
log("| Day | Date | Missions | Learning done/total | New topics done by | Topics proven | Stars root/weak/learning/mastered | Readiness % (mid) |");
log("|---|---|---|---|---|---|---|---|");
for (const r of rows) log(r);
close();
// pnpm runs this from apps/cli; resolve --out against where the command was typed.
if (out) writeFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), out), lines.join("\n") + "\n");
