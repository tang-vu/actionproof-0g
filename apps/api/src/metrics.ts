function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function labels(values: Record<string, string>): string {
  const entries = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`);
  return entries.length > 0 ? `{${entries.join(",")}}` : "";
}

export class MetricsRegistry {
  readonly #http = new Map<
    string,
    { labels: Record<string, string>; count: number; seconds: number }
  >();
  readonly #preflights = new Map<string, number>();
  readonly #jobs = new Map<string, number>();

  observeHttp(method: string, route: string, status: number, durationMs: number): void {
    const values = { method, route, status: String(status) };
    const key = JSON.stringify(values);
    const current = this.#http.get(key) ?? { labels: values, count: 0, seconds: 0 };
    current.count += 1;
    current.seconds += durationMs / 1_000;
    this.#http.set(key, current);
  }

  recordPreflight(disposition: string): void {
    this.#preflights.set(disposition, (this.#preflights.get(disposition) ?? 0) + 1);
  }

  recordJob(status: string): void {
    this.#jobs.set(status, (this.#jobs.get(status) ?? 0) + 1);
  }

  render(runtime: {
    queue: { pending: number; leased: number; exhausted: number };
    webhooks: { pending: number; leased: number; exhausted: number };
  }): string {
    const lines = [
      "# HELP actionproof_http_requests_total HTTP responses emitted by the API.",
      "# TYPE actionproof_http_requests_total counter",
    ];
    for (const metric of this.#http.values()) {
      lines.push(`actionproof_http_requests_total${labels(metric.labels)} ${metric.count}`);
    }
    lines.push(
      "# HELP actionproof_http_request_duration_seconds_sum Total HTTP request duration.",
      "# TYPE actionproof_http_request_duration_seconds_sum counter",
    );
    for (const metric of this.#http.values()) {
      lines.push(
        `actionproof_http_request_duration_seconds_sum${labels(metric.labels)} ${metric.seconds.toFixed(6)}`,
      );
    }
    lines.push(
      "# HELP actionproof_preflight_total Read-only preflight dispositions.",
      "# TYPE actionproof_preflight_total counter",
    );
    for (const [disposition, count] of this.#preflights) {
      lines.push(`actionproof_preflight_total${labels({ disposition })} ${count}`);
    }
    lines.push(
      "# HELP actionproof_jobs_terminal_total Terminal full-assessment jobs.",
      "# TYPE actionproof_jobs_terminal_total counter",
    );
    for (const [status, count] of this.#jobs) {
      lines.push(`actionproof_jobs_terminal_total${labels({ status })} ${count}`);
    }
    for (const [state, value] of Object.entries(runtime.queue)) {
      lines.push(`actionproof_job_queue${labels({ state })} ${value}`);
    }
    for (const [state, value] of Object.entries(runtime.webhooks)) {
      lines.push(`actionproof_webhook_outbox${labels({ state })} ${value}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
