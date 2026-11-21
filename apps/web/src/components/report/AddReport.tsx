"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from "react";
import { PARSE_STAGES } from "@progresso/core/report-parser";
import { markReportAdded } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Surface } from "@/components/ui/Surface";
import type { ReportStreamEvent, StudentSummary } from "@/lib/types";
import { ParseProgress, type StageState } from "./ParseProgress";
import styles from "./AddReport.module.css";

const MAX_CHARS = 200_000;
const TEXT_TYPES = [".txt", ".md", ".text", ".markdown"];

/** UI stages: the parser's own, then the root-cause engine's. */
const STAGES: { id: string; label: string }[] = [
  ...PARSE_STAGES.map((id) => ({
    id,
    label: {
      reading: "Reading the report",
      extracting: "Finding each diagnosed mistake",
      mapping: "Linking mistakes to the syllabus",
      validating: "Checking against the syllabus map",
    }[id],
  })),
  { id: "tracing", label: "Tracing the root causes" },
];

type Phase = "input" | "running" | "done" | "error";

export function AddReport({ student, alreadyAdded }: { student: StudentSummary; alreadyAdded: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("input");
  const [stages, setStages] = useState<StageState[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const textId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const diagnosisHref = `/s/${student.id}/diagnosis`;

  useEffect(() => () => abortRef.current?.abort(), []);

  const readFile = useCallback(async (file: File) => {
    setFileError(undefined);
    const lower = file.name.toLowerCase();
    if (!TEXT_TYPES.some((ext) => lower.endsWith(ext)) && !file.type.startsWith("text/")) {
      setFileError("For now we can read text files (.txt or .md). Copy the report's text and paste it instead.");
      return;
    }
    const content = await file.text();
    if (content.length > MAX_CHARS) {
      setFileError("That file is too long to be a single report.");
      return;
    }
    setText(content);
    setFileName(file.name);
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  async function run() {
    setPhase("running");
    setError(undefined);
    setNotices([]);
    setStages(STAGES.map((s) => ({ ...s, status: "waiting" })));
    const ac = new AbortController();
    abortRef.current = ac;

    const advance = (stage: string, message: string) =>
      setStages((prev) => {
        const idx = prev.findIndex((s) => s.id === stage);
        return prev.map((s, i) => (i < idx ? { ...s, status: "done" } : i === idx ? { ...s, status: "active", message } : s));
      });

    try {
      const res = await fetch(`/api/students/${encodeURIComponent(student.id)}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() || undefined, file_name: fileName }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "We couldn't read this report.");
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line) as ReportStreamEvent;
          if (event.type === "progress") advance(event.stage, event.message);
          else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "done") {
            finished = true;
            setStages((prev) => prev.map((s) => ({ ...s, status: "done" })));
            setNotices(event.notices);
          }
        }
      }
      if (!finished) throw new Error("The connection closed before the report was read.");
      await markReportAdded(student.id);
      setPhase("done");
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStages((prev) => prev.map((s) => (s.status === "active" ? { ...s, status: "failed" } : s)));
      setPhase("error");
    }
  }

  // Move focus to the result so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (phase === "done" || phase === "error") resultRef.current?.focus();
  }, [phase]);

  // Pasted text was ignored in demo mode: keep the student here long enough to read why.
  const textIgnored = notices.length > 1;
  useEffect(() => {
    if (phase !== "done" || textIgnored) return;
    const t = setTimeout(() => router.push(diagnosisHref), 1400);
    return () => clearTimeout(t);
  }, [phase, textIgnored, router, diagnosisHref]);

  const hasText = text.trim().length > 0;

  if (phase !== "input") {
    return (
      <div className={`container ${styles.wrap}`}>
        <Surface level={3} pad="lg" className={styles.runCard} data-enter>
          <ParseProgress stages={stages} running={phase === "running"} failed={phase === "error"} />
          <div ref={resultRef} tabIndex={-1} className={styles.result} aria-live="polite">
            {phase === "done" && (
              <>
                <p className={styles.resultTitle}>
                  <Icon name="check" size={20} />
                  Your diagnosis is ready
                </p>
                {notices.slice(1).map((n) => (
                  <p key={n} className={styles.notice}>
                    <Icon name="info" size={18} />
                    {n}
                  </p>
                ))}
                <Button variant="primary" size="lg" trailingIcon="arrowRight" onClick={() => router.push(diagnosisHref)}>
                  See my diagnosis
                </Button>
              </>
            )}
            {phase === "error" && (
              <>
                <p className={styles.errorTitle} role="alert">
                  <Icon name="alert" size={20} />
                  {error}
                </p>
                <div className={styles.actions}>
                  <Button variant="primary" onClick={() => void run()}>
                    Try again
                  </Button>
                  <Button variant="ghost" onClick={() => setPhase("input")}>
                    Back
                  </Button>
                </div>
              </>
            )}
          </div>
        </Surface>
      </div>
    );
  }

  return (
    <div className={`container ${styles.wrap}`}>
      <Link href="/" className={styles.back}>
        <Icon name="arrowLeft" size={16} />
        All students
      </Link>

      <header className={styles.head} data-enter>
        <h1 className={styles.title}>Add an exam report</h1>
        <p className={styles.lede}>
          Paste the AI diagnosis report Inferentics gave {student.name} after an exam, or upload it as a text file. We&apos;ll
          find the few root gaps behind the mistakes.
        </p>
      </header>

      <div className={styles.demo} role="note" data-enter style={{ "--enter-delay": "60ms" } as React.CSSProperties}>
        <span className={styles.demoTag}>Demo mode</span>
        <p>
          The report reader isn&apos;t built yet. Whatever you add, we&apos;ll load {student.name}&apos;s{" "}
          <strong>sample report</strong> (hand-written sample data, not a real report).
        </p>
      </div>

      <Surface level={2} pad="none" className={styles.inputCard} data-enter style={{ "--enter-delay": "120ms" } as React.CSSProperties}>
        <div className={styles.tabs} role="tablist" aria-label="How to add the report">
          {(["paste", "upload"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              id={`tab-${m}`}
              aria-selected={mode === m}
              aria-controls={`panel-${m}`}
              tabIndex={mode === m ? 0 : -1}
              className={styles.tab}
              onClick={() => setMode(m)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  const next = m === "paste" ? "upload" : "paste";
                  setMode(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
            >
              <Icon name={m === "paste" ? "paste" : "upload"} size={18} />
              {m === "paste" ? "Paste text" : "Upload file"}
            </button>
          ))}
        </div>

        {mode === "paste" ? (
          <div id="panel-paste" role="tabpanel" aria-labelledby="tab-paste" className={styles.panel}>
            <label htmlFor={textId} className="visually-hidden">
              Report text
            </label>
            <textarea
              id={textId}
              className={styles.textarea}
              value={text}
              onChange={(e) => {
                setText(e.target.value.slice(0, MAX_CHARS));
                setFileName(undefined);
              }}
              placeholder={"Paste the full report here…\n\ne.g. “Q7 (2 marks): The student wrote the derivative as cos(x²). The factor 2x from the inner function is missing…”"}
              rows={9}
              spellCheck={false}
            />
            <div className={styles.meta}>
              <span>{fileName ? `From ${fileName}` : "Text stays on this device until you press Read."}</span>
              <span className="tabular">{text.length.toLocaleString("en-IN")} characters</span>
            </div>
          </div>
        ) : (
          <div id="panel-upload" role="tabpanel" aria-labelledby="tab-upload" className={styles.panel}>
            <div
              className={styles.drop}
              data-dragging={dragging || undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className={styles.dropIcon}>
                <Icon name={fileName ? "doc" : "upload"} size={24} />
              </span>
              {fileName ? (
                <p>
                  <strong>{fileName}</strong>
                  <br />
                  <span className={styles.dim}>{text.length.toLocaleString("en-IN")} characters read</span>
                </p>
              ) : (
                <p>
                  <strong>Drop the report file here</strong>
                  <br />
                  <span className={styles.dim}>Text files (.txt, .md)</span>
                </p>
              )}
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                {fileName ? "Choose another file" : "Choose a file"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={[...TEXT_TYPES, "text/plain", "text/markdown"].join(",")}
                className="visually-hidden"
                tabIndex={-1}
                aria-label="Report file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            {fileError && (
              <p className={styles.fileError} role="alert">
                {fileError}
              </p>
            )}
          </div>
        )}

        <div className={styles.footer}>
          <p className={styles.hint}>
            {alreadyAdded ? (
              <>
                A report is already added.{" "}
                <Link href={`/s/${student.id}/diagnosis`}>See the diagnosis</Link>
              </>
            ) : hasText ? (
              "We'll read it, then trace the root causes."
            ) : (
              "Nothing to paste? Load the sample report."
            )}
          </p>
          <Button variant="primary" size="lg" icon="spark" onClick={() => void run()}>
            {hasText ? "Read report" : "Load sample report"}
          </Button>
        </div>
      </Surface>
    </div>
  );
}
