import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import { Providers } from "../components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ActionProof — Proof before action", template: "%s · ActionProof" },
  description:
    "A verifiable runtime firewall that analyzes, simulates, attests, and audits autonomous agent transactions before execution on 0G.",
  openGraph: {
    title: "ActionProof — Proof before action",
    description: "Verifiable pre-execution evidence for autonomous onchain actions.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
