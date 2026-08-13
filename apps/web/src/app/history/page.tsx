import type { Metadata } from "next";

import { HistoryView } from "../../components/history-view";

export const metadata: Metadata = { title: "Agent history" };

export default function HistoryPage() {
  return (
    <div className="workspace-page content-width history-page">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Event-based audit history</span>
          <h1>Agent traces</h1>
          <p>Stored reports and chain receipts retain their live or sandbox provenance.</p>
        </div>
      </div>
      <HistoryView />
    </div>
  );
}
