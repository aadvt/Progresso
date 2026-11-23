"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const INTERVAL_MS = 3000;

/**
 * Keeps an open page in step with progress made elsewhere (the MCP server in
 * Claude, another tab). Polls a tiny version fingerprint while the tab is
 * visible and re-renders the server components only when it changes; the
 * constellation then animates the difference (and plays the ripple).
 */
export function LiveSync({ studentId }: { studentId: string }) {
  const router = useRouter();

  useEffect(() => {
    const url = `/api/students/${encodeURIComponent(studentId)}/version`;
    let version: string | null = null;
    let busy = false;

    async function check() {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const { version: v } = (await res.json()) as { version: string };
          if (version !== null && v !== version) router.refresh();
          version = v;
        }
      } catch {
        // Offline or the server is restarting: try again on the next tick.
      } finally {
        busy = false;
      }
    }

    void check();
    const timer = window.setInterval(check, INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [studentId, router]);

  return null;
}
