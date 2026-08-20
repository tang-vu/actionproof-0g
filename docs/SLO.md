# Service objectives and alert contract

These are proposed objectives for an operated production service, not historical achievements or a
contractual SLA.

| Signal                           | Proposed objective          | Page condition                                      |
| -------------------------------- | --------------------------- | --------------------------------------------------- |
| Public preflight availability    | 99.9% over 30 days          | 5-minute success rate below 99%                     |
| Public preflight latency         | 95% below 3 seconds         | p95 above 5 seconds for 10 minutes                  |
| Full assessment terminal success | 99% excluding policy blocks | failure ratio above 5% for 10 minutes               |
| Job queue                        | no exhausted leases         | `actionproof_job_queue{state="exhausted"} > 0`      |
| Webhook outbox                   | no exhausted deliveries     | `actionproof_webhook_outbox{state="exhausted"} > 0` |
| Evidence integrity               | 100% self-verification      | any completed trace with invalid verification       |

`/metrics` exposes aggregate HTTP counts/duration sums, preflight dispositions, terminal job counts,
job queue state, and webhook outbox state. Do not attach tenant IDs, addresses, calldata, secrets, or
intent text as metric labels. Logs and traces should use request/job IDs for controlled correlation.

Before offering a contractual SLA, operate a representative canary for at least one measurement
window, validate dashboards against fault injection, define maintenance/exclusion rules, and assign
an incident owner and communication channel.
