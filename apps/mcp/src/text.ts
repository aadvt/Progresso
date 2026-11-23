/**
 * Plain-text (Markdown) versions of every tool result. This is what the model
 * reads, and all a host without MCP Apps support shows, so each one stands on
 * its own and says what to do next. Maths stays as $…$ LaTeX.
 * No answer key appears before the student has answered.
 */
import type { ExplainData } from "./explain";
import type { AnswerData, FeedbackView, MissionWidgetData, ProgressData, ResultInfo, ScoreRange } from "./shared/types";

const pct = (r: ScoreRange) => `${Math.round(r.low)}–${Math.round(r.high)}% (most likely ${Math.round(r.mid)}%)`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const quote = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");

const SAMPLE = "_SAMPLE DATA: a demo student built from hand-written fixtures, not a real report._";

export function missionText(d: MissionWidgetData): string {
  const out: string[] = [];
  if (d.sample) out.push(SAMPLE);
  if (d.state === "no_plan") {
    out.push(
      `No comeback plan for student \`${d.student_id}\`: there is no upcoming exam date to plan back from, or nothing in the report to fix with missions. Open ${d.links.today} to set one up.`,
    );
    return out.join("\n\n");
  }
  if (d.plan_created && d.exam) out.push(`(Set up a comeback plan: ${d.exam.name} on ${d.exam.date}, 25 minutes a day. It can be changed in the web app.)`);
  if (d.state === "nothing_today") {
    out.push(`Nothing is scheduled for tonight (${d.today}).${d.next ? ` Next: **${d.next.title}** on ${d.next.date}.` : ""}`);
    return out.join("\n\n");
  }
  const m = d.mission!;
  const head = d.state === "done_today" ? `Tonight's mission is done ✓` : `Tonight's mission${m.of > 1 ? ` (${m.index} of ${m.of})` : ""}`;
  out.push(`## ${head}: ${m.title}\n${m.subtitle} · ${m.minutes} min · ${m.steps.map((s) => s.label).join(" → ")}\n\nWhy tonight: ${m.reason}`);
  if (d.exam) out.push(`Exam: ${d.exam.name}, ${d.exam.date} (${plural(d.exam.days_left, "day")} left).`);

  if (d.root) {
    const r = d.root;
    out.push(
      `### The root gap: ${r.name}${r.via ? ` (applied in ${r.via})` : ""}\nRoot ${r.rank} of ${r.roots_total}. Explains ${plural(r.errors_explained, "mistake")} across ${plural(r.exams, "exam")}, ~${r.marks_lost}${r.marks_estimated ? " (partly estimated)" : ""} marks lost.\n${r.explanation}`,
    );
  }

  if (d.recap) {
    const c = d.recap;
    const lines = [`### Mistake Recap: ${c.exam_name} · ${c.question_ref}${c.marks_lost !== undefined ? ` · ${c.marks_lost}${c.marks_max ? ` of ${c.marks_max}` : ""} marks lost` : ""}`];
    if (c.question) lines.push(`Question: ${c.question.text}`);
    lines.push(`What the report says (verbatim):\n${quote(c.diagnosis)}`);
    if (c.wrong) {
      const label = c.mode === "student_working" ? "The student's working, as quoted in the report" : "A typical wrong step (not the student's own working)";
      lines.push(`${label}:\n${c.wrong.lines.map((l) => `- ${l.wrong ? "✗ " : ""}${stripTags(l.segments.map((s) => s.html).join(""))}`).join("\n")}\nWhat went wrong: ${c.wrong.note.text}`);
    }
    if (c.fix) lines.push(`The fix:\n${c.fix.map((f, i) => `${i + 1}. ${f.text}`).join("\n")}`);
    if (c.key_idea) lines.push(`Key idea: ${c.key_idea.text}`);
    if (c.more > 0) lines.push(`(+${plural(c.more, "more mistake")} from the report in this mission.)`);
    out.push(lines.join("\n"));
  }

  const ex = d.explainer;
  if (ex && (ex.video || ex.steps || ex.watch_for.length)) {
    const lines = ["### Explainer"];
    if (ex.video) lines.push(`- Video (${Math.round(ex.video.duration_s)} s): "${ex.video.title}": ${ex.video.url}`);
    if (ex.steps) lines.push(`- Step-by-step: "${ex.steps.title}" (${ex.steps.count} steps, in the full mission: ${d.links.mission ?? d.links.today}). Takeaway: ${ex.steps.takeaway.text}`);
    if (ex.watch_for.length) lines.push(`- Watch for: ${ex.watch_for.map((w) => `${w.description}${w.yours ? " (the report shows this one)" : ""}`).join("; ")}`);
    out.push(lines.join("\n"));
  }

  if (d.questions.length > 0) {
    const open = d.questions.filter((q) => !q.answered).length;
    const qs = d.questions.map((q, i) => {
      const opts = q.options ? "\n" + q.options.map((o) => `   ${o.id.toUpperCase()}) ${o.label.text}`).join("\n") : `\n   (type a number${q.unit ? ` in ${q.unit}` : ""})`;
      const status = q.answered ? `\n   → answered: ${q.answered.correct ? "correct ✓" : `not right (${q.answered.chosen.toUpperCase()})`}` : "";
      return `${i + 1}. [question_id: ${q.id}] ${q.stem.text}${opts}${status}`;
    });
    out.push(`### Prove it (${d.questions.length} questions, mission_id: ${m.id})\n${qs.join("\n")}`);
    if (open > 0 && d.state === "ready")
      out.push(
        `How to run this: if the interactive widget is showing, the student answers inside it and each answer is reported back to you. Otherwise, ask the questions one at a time and call \`submit_answer\` with mission_id, question_id and the option letter (or the number). Don't reveal answers before the student has tried. The mission finishes automatically after the last answer.`,
      );
  } else if (d.state === "ready") {
    out.push(`There are no verified prove-it questions for this topic yet, so tonight is recap + explainer only ("studied, not proven"). Call \`finish_mission\` with mission_id ${m.id} when the student has gone through it.`);
  }
  if (d.result) out.push(resultText(d.result));
  if (d.next) out.push(`Next up: **${d.next.title}** (${d.next.date}).`);
  out.push(`Full mission with the animated recap and explainer: ${d.links.mission ?? d.links.today}`);
  return out.join("\n\n");
}

function stripTags(html: string): string {
  // Working lines are escaped plain text (plus MathML for LaTeX quotes): the annotation holds the TeX source.
  return html
    .replace(/<math[\s\S]*?<annotation encoding="application\/x-tex">([^<]*)<\/annotation>[\s\S]*?<\/math>/g, (_m, src: string) => `$${src}$`)
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function feedbackText(f: FeedbackView): string {
  const lines = [f.correct ? "Correct ✓" : `Not quite (answered ${f.chosen.length === 1 ? f.chosen.toUpperCase() : f.chosen}).`];
  lines.push(f.feedback.text);
  if (!f.correct && f.correct_display) lines.push(`Correct answer: ${f.correct_display.text}`);
  if (f.misconception) {
    lines.push(
      `This wrong answer is the misconception "${f.misconception.description}"${f.misconception.yours ? `, the same one the report found in ${f.misconception.yours.exam_name} ${f.misconception.yours.question_ref}` : ""}.`,
    );
  }
  lines.push(`Worked solution: ${f.solution.text}`);
  return lines.join("\n");
}

export function resultText(r: ResultInfo): string {
  const lines = [`### Mission result: ${r.passed ? "passed ✓" : "not yet"}`];
  for (const o of r.outcomes) {
    lines.push(`- ${o.concept_name}: ${o.total > 0 ? `${o.correct}/${o.total} correct, ` : ""}${o.before === "none" ? "new" : o.before} → ${o.after}. ${o.reason}`);
  }
  if (r.ripple_root) lines.push(`🌟 The root "${r.ripple_root}" is now proven: the constellation in the web app lights up everything built on it.`);
  lines.push(`Readiness (estimate): ${r.readiness_before ? `${pct(r.readiness_before)} → ` : ""}${pct(r.readiness_after)}.`);
  return lines.join("\n");
}

export function answerText(a: AnswerData): string {
  const out = [`Question ${a.answered} of ${a.total} recorded (mission ${a.mission_id}).`, feedbackText(a.feedback)];
  if (a.result) out.push(resultText(a.result), `Saved to the student's progress; the web app (${a.links.constellation}) shows it.`);
  else if (a.answered < a.total) out.push(`${a.total - a.answered} to go.`);
  if (!a.feedback.correct)
    out.push(`To go deeper, call \`explain_my_mistake\` with question_id ${a.question_id}: it ties this answer back to the mistakes in the student's report.`);
  return out.join("\n\n");
}

export function progressText(p: ProgressData): string {
  const out: string[] = [];
  if (p.sample) out.push(SAMPLE);
  out.push(`## Progress for \`${p.student_id}\` (${p.today})`);
  if (p.exam) out.push(`Exam: ${p.exam.name}, ${p.exam.date} (${plural(p.exam.days_left, "day")} left).${p.has_plan ? "" : " No comeback plan yet: call get_tonight_mission to start one."}`);
  out.push(
    `Roots fixed: **${p.roots_fixed} of ${p.roots.length}**\n` +
      p.roots
        .map((r) => `${r.rank}. ${r.name}: ${r.state === "gap" ? "still a gap" : r.state}${r.state === "proven" || r.state === "retained" ? " ✓" : ""} (explains ${plural(r.errors_explained, "mistake")}, ~${r.marks_lost} marks; ${plural(r.downstream, "topic")} build on it)`)
        .join("\n"),
  );
  out.push(`Readiness (estimate, always a range): now ${pct(p.readiness.now)}; started at ${pct(p.readiness.start)}; if every planned topic is proven and held: ${pct(p.readiness.potential)}.`);
  if (p.has_plan) out.push(`Missions done: ${p.missions_done}. Topics proven: ${p.concepts_proven} of ${p.concepts_targeted}.`);
  if (p.still_making.length) out.push(`Still showing up in checks: ${p.still_making.map((s) => `${s.description} (${s.concept})`).join("; ")}.`);
  out.push(`Constellation: ${p.links.constellation}`);
  return out.join("\n\n");
}

export function explainText(e: ExplainData): string {
  const out: string[] = [];
  if (e.matched_by === "none") {
    out.push(
      `No mistake in the student's report matched "${e.query}". These are the mistakes on record (ask about one by question, exam or topic):\n` +
        (e.available ?? []).map((a) => `- ${a.exam_name} ${a.question_ref}: ${a.concept}`).join("\n"),
    );
    return out.join("\n\n");
  }
  out.push(
    "Use only the facts below to explain this in plain language. The report's words are quoted verbatim. Only describe working as the student's own when it is marked as quoted from the report; don't invent their steps.",
  );
  if (e.check_answer) {
    const c = e.check_answer;
    out.push(
      `### Their prove-it answer\nQuestion: ${c.question}\nThey answered: ${c.given} (${c.correct ? "correct" : "wrong"})${c.misconception ? `\nMisconception it shows: ${c.misconception}` : ""}\nWorked solution: ${c.solution}`,
    );
  }
  const explained = new Set<string>();
  for (const m of e.mistakes) {
    const lines = [`### ${m.exam_name} (${m.exam_date}) · ${m.question_ref} · ${m.concept}${m.marks_lost !== undefined ? ` · ${m.marks_lost}${m.marks_max ? `/${m.marks_max}` : ""} marks lost` : ""}`];
    if (m.question_text) lines.push(`Question: ${m.question_text}`);
    lines.push(`Report diagnosis (verbatim):\n${quote(m.report_diagnosis)}`);
    if (m.student_working) lines.push(`Student's working, quoted in the report:\n${quote(m.student_working)}`);
    if (m.report_correct_approach) lines.push(`Report's correct approach (verbatim):\n${quote(m.report_correct_approach)}`);
    if (m.misconception) lines.push(`Misconception: ${m.misconception}`);
    if (m.traces_to) {
      const t = m.traces_to;
      lines.push(t.path.length > 1 ? `Traces back to the root gap **${t.root}**: ${t.path.join(" → ")}.` : `This question tested the root gap **${t.root}** itself.`);
      if (!explained.has(t.root)) {
        explained.add(t.root);
        lines.push(`Why ${t.root} is the root: ${t.root_explanation}`);
      }
    }
    if (m.verified_fix) lines.push(`Verified fix:\n${m.verified_fix.lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\nKey idea: ${m.verified_fix.key_idea}`);
    out.push(lines.join("\n"));
  }
  if (e.explainer) out.push(`### Verified explainer: ${e.explainer.title}\n${e.explainer.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\nTakeaway: ${e.explainer.takeaway}`);
  return out.join("\n\n");
}
