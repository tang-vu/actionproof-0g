import Link from "next/link";
import type { ReactNode } from "react";

import { configuredMode } from "../lib/config";
import { Brand } from "./brand";
import { WalletControl } from "./wallet-control";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <nav className="main-nav" aria-label="Primary navigation">
          <Link href="/analyze">Analyze</Link>
          <Link href="/history">History</Link>
          <Link href="/developers">Developers</Link>
          <Link href="/architecture">Architecture</Link>
        </nav>
        <div className="topbar-actions">
          <span className={`mode-pill ${configuredMode === "live" ? "live" : "sandbox"}`}>
            {configuredMode === "live" ? "0G live" : "Sandbox"}
          </span>
          <WalletControl />
        </div>
      </header>
      <main>{children}</main>
      <footer className="footer">
        <div>
          <Brand />
          <p>Experimental security infrastructure. Not audited. Do not use with valuable assets.</p>
        </div>
        <div className="footer-links">
          <a href="https://docs.0g.ai/" target="_blank" rel="noreferrer">
            0G docs ↗
          </a>
          <Link href="/architecture">Security model</Link>
          <Link href="/developers">Developer API</Link>
        </div>
      </footer>
    </div>
  );
}
