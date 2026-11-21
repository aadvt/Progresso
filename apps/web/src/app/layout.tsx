import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { Backdrop } from "@/components/ui/Backdrop";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: { default: "Progresso", template: "%s · Progresso" },
  description: "Turns your exam report into a short, personal plan that gets you ready for your next exam.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f3f6fa",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Backdrop />
        {children}
      </body>
    </html>
  );
}
