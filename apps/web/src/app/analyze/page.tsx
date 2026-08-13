import type { Metadata } from "next";

import { AnalysisConsole } from "../../components/analysis-console";
import { IntegrationStatus } from "../../components/integration-status";

export const metadata: Metadata = { title: "Analyze action" };

export default function AnalyzePage() {
  const initialIssuedAt = Math.floor(Date.now() / 1000);

  return (
    <div className="workspace-page content-width">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Pre-execution workspace</span>
          <h1>Analyze an agent action</h1>
          <p>
            Every claim below is generated from the submitted envelope and actual runtime stage.
          </p>
        </div>
        <div className="guard-rail">
          <span>Guard policy</span>
          <strong>actionproof-policy/1</strong>
        </div>
      </div>
      <AnalysisConsole initialIssuedAt={initialIssuedAt} />
      <div className="analyze-status">
        <IntegrationStatus />
      </div>
    </div>
  );
}
