import { ButtonLink } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { TopBar } from "@/components/ui/TopBar";

export default function NotFound() {
  return (
    <>
      <TopBar />
      <main id="main" className="container" style={{ paddingBlock: "4rem", maxWidth: "36rem" }}>
        <Surface level={2} pad="lg" style={{ display: "grid", gap: "1rem", justifyItems: "start" }}>
          <h1 style={{ fontSize: "var(--text-2xl)" }}>We couldn&apos;t find that page</h1>
          <p style={{ color: "var(--ink-2)" }}>The student or page may not exist in this prototype.</p>
          <ButtonLink href="/" variant="primary" icon="arrowLeft">
            Back to students
          </ButtonLink>
        </Surface>
      </main>
    </>
  );
}
