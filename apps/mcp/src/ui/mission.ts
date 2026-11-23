/**
 * Mission widget (ui://progresso/mission.html), rendered by the host for
 * get_tonight_mission: tonight's root gap, a Mistake Recap preview, explainer
 * links and the prove-it questions, answerable right here.
 *
 * Each answer goes to the server (submit_answer: graded and saved in the same
 * database as the web app), then the model is told what happened
 * (updateModelContext), so Claude can follow up on what the student got wrong.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import type { AnswerData, FeedbackView, MissionWidgetData, QuestionView, RecapPreview, ResultInfo } from "../shared/types";
import { brand, connectApp, h, meter, opener, type Child } from "./common";
import "./widget.css";

let data: MissionWidgetData | undefined;
/** The question on screen. */
let idx = 0;
let chosen: string | undefined;
let busy = false;
let error: string | undefined;

const app: App = connectApp("Progresso mission", (d) => {
  const next = d as MissionWidgetData;
  if (next.view !== "mission") return;
  data = next;
  const firstOpen = data.questions.findIndex((q) => !q.answered);
  idx = firstOpen >= 0 ? firstOpen : Math.max(0, data.questions.length - 1);
  chosen = undefined;
  error = undefined;
  render();
});
const open = opener(app);

function render(focus?: string): void {
  const root = document.getElementById("app")!;
  if (!data) return;
  root.replaceChildren(view(data));
  if (focus) (document.querySelector<HTMLElement>(focus))?.focus();
}

function view(d: MissionWidgetData): HTMLElement {
  if (d.state === "no_plan" || d.state === "nothing_today" || !d.mission) {
    return h(
      "div",
      { class: "card" },
      brand(d.sample, "Tonight"),
      h("h1", {}, d.state === "no_plan" ? "No plan to run yet" : "Nothing scheduled tonight"),
      h(
        "p",
        { class: "why" },
        d.state === "no_plan"
          ? "There's no upcoming exam to plan back from, or nothing in the report to fix with missions."
          : d.next
            ? `Rest day. Next up: ${d.next.title} (${d.next.date}).`
            : "Rest day.",
      ),
      footer(d),
    );
  }
  const m = d.mission;
  const done = !!d.result || d.state === "done_today";
  const proveNow = d.questions.length > 0 && !done;
  return h(
    "div",
    { class: "card" },
    brand(d.sample, done ? "Tonight · done" : "Tonight's mission"),
    h("h1", {}, m.title),
    h(
      "div",
      { class: "meta" },
      [m.subtitle, `${m.minutes} min`, d.exam ? `${d.exam.name} in ${d.exam.days_left} day${d.exam.days_left === 1 ? "" : "s"}` : "", m.of > 1 ? `mission ${m.index} of ${m.of}` : ""]
        .filter(Boolean)
        .join(" · "),
    ),
    h(
      "ol",
      { class: "steps", "aria-label": "Mission steps" },
      ...m.steps.map((s) => h("li", { class: done ? "done" : s.kind === "prove_it" && proveNow ? "now" : "" }, `${s.label} · ${s.minutes}′`)),
    ),
    d.plan_created && d.exam ? h("p", { class: "why" }, `New comeback plan: ${d.exam.name} on ${d.exam.date}, 25 minutes a day.`) : null,
    h("p", { class: "why" }, m.reason),
    d.root ? rootSection(d) : null,
    d.recap ? recapSection(d.recap) : null,
    explainerSection(d),
    proveSection(d),
    footer(d),
  );
}

function rootSection(d: MissionWidgetData): HTMLElement {
  const r = d.root!;
  const fixed = d.result?.ripple_root === r.name;
  return h(
    "section",
    { "aria-labelledby": "root-h" },
    h("h2", { id: "root-h" }, "The root gap"),
    h(
      "div",
      { class: "root" },
      h("span", { class: `root-dot${fixed ? " fixed" : ""}`, "aria-hidden": "true" }),
      h(
        "div",
        {},
        h("div", { class: "root-name" }, r.name, r.via ? h("span", { class: "muted" }, ` · applied in ${r.via}`) : null),
        h("div", { class: "meta" }, [r.chapter, r.class ? `Class ${r.class}` : "", `root ${r.rank} of ${r.roots_total}`].filter(Boolean).join(" · ")),
        h(
          "ul",
          { class: "facts" },
          h("li", {}, `Explains ${r.errors_explained} mistake${r.errors_explained === 1 ? "" : "s"}`),
          h("li", {}, `across ${r.exams} exam${r.exams === 1 ? "" : "s"}`),
          h("li", { class: "teal" }, `~${r.marks_lost}${r.marks_estimated ? "*" : ""} marks to win back`),
        ),
      ),
    ),
    h("details", {}, h("summary", {}, "Why this is the root"), h("p", { class: "explain" }, r.explanation)),
  );
}

function recapSection(c: RecapPreview): HTMLElement {
  const marks = c.marks_lost !== undefined ? ` · ${c.marks_lost}${c.marks_max ? ` of ${c.marks_max}` : ""} marks lost` : "";
  const parts: Child[] = [
    h("h2", { id: "recap-h" }, "Mistake Recap"),
    h("div", { class: "source", html: `<b>${esc(c.exam_name)}</b> · ${esc(c.question_ref)}${esc(marks)}${c.more > 0 ? ` · +${c.more} more in this mission` : ""}` }),
    c.question ? h("p", { class: "question", html: c.question.html }) : null,
  ];
  if (c.wrong) {
    const own = c.mode === "student_working";
    parts.push(
      h(
        "div",
        { class: `sheet${own && c.wrong.format === "plain" ? " hand" : ""}` },
        h("div", { class: "sheet-label", html: own ? "Your working, as quoted in your report" : `A typical wrong step <span class="not-yours">Not your working</span>` }),
        ...c.wrong.lines.map((l) =>
          h("div", { class: `sheet-line${l.wrong ? " wrong" : ""}`, html: l.segments.map((s) => (s.marked ? `<span class="mark">${s.html}</span>` : s.html)).join("") }),
        ),
        h("p", { class: "note", html: c.wrong.note.html }),
      ),
    );
  } else {
    parts.push(h("blockquote", { class: "quote" }, c.diagnosis));
  }
  if (c.fix || c.key_idea) {
    parts.push(
      h(
        "details",
        {},
        h("summary", {}, "Show the fix"),
        c.fix ? h("ol", { class: "fix" }, ...c.fix.map((f) => h("li", { html: f.html }))) : null,
        c.key_idea ? h("p", { class: "key", html: `<b>Key idea.</b> ${c.key_idea.html}` }) : null,
        c.wrong ? h("p", { class: "muted", style: "font-size:12px;margin:8px 0 0" }, `What the report says: “${c.diagnosis}”`) : null,
      ),
    );
  }
  return h("section", { "aria-labelledby": "recap-h" }, ...parts);
}

function explainerSection(d: MissionWidgetData): HTMLElement | null {
  const e = d.explainer;
  if (!e || (!e.video && !e.steps && e.watch_for.length === 0)) return null;
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return h(
    "section",
    { "aria-labelledby": "exp-h" },
    h("h2", { id: "exp-h" }, "Explainer"),
    h(
      "div",
      { class: "row" },
      e.video
        ? h("button", { class: "btn", type: "button", onclick: open(e.video.url), title: e.video.title }, h("span", { class: "play", "aria-hidden": "true" }, "▶"), `Watch the explainer (${mins(e.video.duration_s)})`)
        : null,
      e.steps && d.links.mission ? h("button", { class: "btn", type: "button", onclick: open(d.links.mission) }, `Step by step (${e.steps.count} steps)`) : null,
    ),
    e.steps ? h("p", { class: "explain", html: `<b>${esc(e.steps.title)}.</b> ${e.steps.takeaway.html}` }) : null,
    e.watch_for.length
      ? h("ul", { class: "watch", "aria-label": "Watch for" }, ...e.watch_for.map((w) => h("li", {}, h("span", {}, w.description, w.yours ? h("span", { class: "yours" }, " · in your report") : null))))
      : null,
  );
}

// ---------------------------------------------------------------- prove it

function proveSection(d: MissionWidgetData): HTMLElement | null {
  const qs = d.questions;
  if (qs.length === 0) {
    return h(
      "section",
      {},
      h("h2", {}, "Prove it"),
      h("p", { class: "explain" }, "No verified questions for this topic yet, so tonight counts as studied, not proven. Ask Claude to finish the mission when you've gone through the recap and explainer."),
      d.result ? resultView(d.result, d) : null,
    );
  }
  const q = qs[idx]!;
  const dashes = h(
    "div",
    { class: "dashes", "aria-hidden": "true" },
    ...qs.map((x, i) => h("i", { class: x.answered ? (x.answered.correct ? "right" : "wrong") : i === idx ? "on" : "" })),
  );
  return h(
    "section",
    { "aria-labelledby": "prove-h" },
    h("div", { class: "qhead" }, h("h2", { id: "prove-h" }, `Prove it · question ${idx + 1} of ${qs.length}`), dashes),
    h("p", { class: "stem", id: "stem", html: q.stem.html }),
    q.kind === "mcq" ? options(q) : numeric(q),
    q.answered ? feedbackView(q.answered, q) : null,
    actions(q, d),
    error ? h("p", { class: "feedback bad", role: "alert" }, error) : null,
    d.result && allAnswered(d) && idx === qs.length - 1 ? resultView(d.result, d) : null,
  );
}

const allAnswered = (d: MissionWidgetData) => d.questions.every((q) => q.answered);

function options(q: QuestionView): HTMLElement {
  const a = q.answered;
  return h(
    "div",
    { class: "options", role: "group", "aria-labelledby": "stem" },
    ...(q.options ?? []).map((o) => {
      const cls = a ? (o.id === a.correct_option_id ? " is-right" : o.id === a.chosen && !a.correct ? " is-wrong" : "") : "";
      return h(
        "button",
        {
          class: `opt${cls}`,
          type: "button",
          "aria-pressed": String(a ? a.chosen === o.id : chosen === o.id),
          disabled: !!a || busy,
          "data-opt": o.id,
          onclick: () => {
            chosen = o.id;
            render(`[data-opt="${o.id}"]`);
          },
        },
        h("span", { class: "letter" }, o.id),
        h("span", { html: o.label.html }),
      );
    }),
  );
}

function numeric(q: QuestionView): HTMLElement {
  const input = h("input", {
    id: "num",
    inputmode: "decimal",
    autocomplete: "off",
    "aria-labelledby": "stem",
    value: q.answered?.chosen ?? chosen ?? "",
    disabled: !!q.answered || busy,
    oninput: (e: Event) => {
      chosen = (e.target as HTMLInputElement).value;
      const btn = document.getElementById("check") as HTMLButtonElement | null;
      if (btn) btn.disabled = !chosen?.trim();
    },
    onkeydown: (e: Event) => {
      if ((e as KeyboardEvent).key === "Enter" && chosen?.trim()) void check(q);
    },
  });
  return h("div", { class: "num" }, input, q.unit ? h("span", { class: "muted" }, q.unit) : null);
}

function feedbackView(f: FeedbackView, q: QuestionView): HTMLElement {
  return h(
    "div",
    { class: `feedback${f.correct ? "" : " bad"}`, role: "status", id: "fb", tabindex: "-1" },
    h("strong", {}, f.correct ? "Correct" : "Not quite"),
    h("div", { html: f.feedback.html }),
    !f.correct && f.correct_display ? h("div", { html: `Correct answer: ${f.correct_display.html}` }) : null,
    f.misconception?.yours ? h("span", { class: "tag" }, `Same mistake as ${f.misconception.yours.exam_name} ${f.misconception.yours.question_ref} in your report`) : null,
    h("details", {}, h("summary", {}, "Worked solution"), h("p", { html: f.solution.html })),
    !f.correct
      ? h(
          "div",
          { class: "actions" },
          h(
            "button",
            {
              class: "link",
              type: "button",
              onclick: () => ask(`Why was my answer to this prove-it question wrong? (question_id ${q.id})`),
            },
            "Ask Claude why →",
          ),
        )
      : null,
  );
}

function actions(q: QuestionView, d: MissionWidgetData): HTMLElement | null {
  if (!q.answered) {
    return h(
      "div",
      { class: "actions" },
      h("button", { class: "btn primary", id: "check", type: "button", disabled: busy || !chosen?.trim(), onclick: () => void check(q) }, busy ? "Checking…" : "Check answer"),
    );
  }
  if (idx < d.questions.length - 1) {
    return h(
      "div",
      { class: "actions" },
      h(
        "button",
        {
          class: "btn primary",
          id: "next",
          type: "button",
          onclick: () => {
            idx++;
            chosen = undefined;
            error = undefined;
            render("#stem");
          },
        },
        "Next question →",
      ),
    );
  }
  return null;
}

function resultView(r: ResultInfo, d: MissionWidgetData): HTMLElement {
  const wrong = d.questions.filter((q) => q.answered && !q.answered.correct).length;
  return h(
    "div",
    { class: "feedback result", id: "result", tabindex: "-1", style: "background:var(--thread-soft);border-color:var(--line)" },
    h("div", { class: "big" }, r.passed ? "Mission passed ✓" : "Not proven yet: it's in your plan again"),
    ...r.outcomes.map((o) => h("p", { style: "margin:4px 0" }, h("b", {}, o.concept_name), `: ${o.total > 0 ? `${o.correct}/${o.total} · ` : ""}${o.before === "none" ? "new" : o.before} → ${o.after}. `, h("span", { class: "muted" }, o.reason))),
    meter(r.readiness_after, r.readiness_before),
    r.ripple_root ? h("div", { class: "ripple" }, h("b", {}, `${r.ripple_root} is fixed.`), " Everything built on it lights up in your constellation.") : null,
    h(
      "div",
      { class: "actions" },
      wrong > 0
        ? h("button", { class: "btn primary", type: "button", onclick: () => ask(`I just finished tonight's Progresso check and got ${wrong} wrong. Can you go over what I got wrong?`) }, "Go over my mistakes with Claude")
        : h("button", { class: "btn primary", type: "button", onclick: () => ask("I passed tonight's Progresso check. What's next?") }, "What's next?"),
      h("button", { class: "btn", type: "button", onclick: open(d.links.constellation) }, "Open my constellation"),
    ),
  );
}

function footer(d: MissionWidgetData): HTMLElement {
  return h(
    "div",
    { class: "foot" },
    h("span", {}, d.next ? `Next: ${d.next.title} · ${d.next.date}` : `Today: ${d.today}`),
    h("button", { class: "link", type: "button", onclick: open(d.links.mission ?? d.links.today) }, "Open in Progresso ↗"),
  );
}

// ---------------------------------------------------------------- talking to the host

async function check(q: QuestionView): Promise<void> {
  if (!data || busy || !chosen?.trim()) return;
  busy = true;
  error = undefined;
  render();
  try {
    const res = await app.callServerTool({
      name: "submit_answer",
      arguments: { student: data.student_id, mission_id: data.mission!.id, question_id: q.id, answer: chosen.trim() },
    });
    if (res.isError) {
      error = res.content?.find((c) => c.type === "text")?.text ?? "Couldn't record that answer.";
    } else {
      const a = res.structuredContent as unknown as AnswerData;
      q.answered = a.feedback;
      if (a.result) data.result = a.result;
      chosen = undefined;
      void tellModel();
    }
  } catch (e) {
    error = "Couldn't reach Progresso. Try again.";
    console.error(e);
  } finally {
    busy = false;
    render(error ? undefined : data?.result && allAnswered(data) ? "#result" : "#fb");
  }
}

/** Keep the model up to date with what happened in the widget, so it can follow up without being asked to look. */
async function tellModel(): Promise<void> {
  const d = data;
  if (!d?.mission) return;
  const answered = d.questions.filter((q) => q.answered);
  const lines = d.questions.map((q, i) => {
    const a = q.answered;
    if (!a) return `- Q${i + 1} (question_id ${q.id}): not answered yet. ${q.stem.text}`;
    const mis = a.misconception ? ` Misconception shown: "${a.misconception.description}"${a.misconception.yours ? ` (the same one their report found in ${a.misconception.yours.exam_name} ${a.misconception.yours.question_ref})` : ""}.` : "";
    return `- Q${i + 1} (question_id ${q.id}): ${q.stem.text} → answered ${a.chosen}: ${a.correct ? "correct" : "wrong"}.${mis}`;
  });
  const r = d.result;
  const text = `---
progresso-mission: ${d.mission.id}
student: ${d.student_id}
answered: ${answered.length}/${d.questions.length}
correct: ${answered.filter((q) => q.answered!.correct).length}
---
The student is answering tonight's prove-it questions in the Progresso widget ("${d.mission.title}"). Their answers are already saved; don't ask them to repeat them.
${lines.join("\n")}${
    r
      ? `\nMission finished: ${r.passed ? "passed" : "not proven yet (it comes back in the plan)"}. ${r.outcomes.map((o) => `${o.concept_name}: ${o.before} → ${o.after}`).join("; ")}.${r.ripple_root ? ` The root "${r.ripple_root}" is now proven.` : ""} Readiness estimate now ${Math.round(r.readiness_after.low)}–${Math.round(r.readiness_after.high)}%.`
      : ""
  }
For any wrong answer, call explain_my_mistake with its question_id to tie it to the student's report before explaining.`;
  try {
    await app.updateModelContext({ content: [{ type: "text", text }] });
  } catch (e) {
    console.warn("[progresso widget] updateModelContext not supported", e);
  }
}

function ask(text: string): void {
  void tellModel().finally(() => {
    app.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch((e) => console.warn("[progresso widget] sendMessage failed", e));
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
