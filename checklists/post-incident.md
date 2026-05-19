# Post-Incident Checklist

When a `SafetyError` fires unexpectedly in production — or worse, when a write happened that shouldn't have — work through this.

## Immediate triage (first 30 min)

- [ ] Stop the writes. Set `MODE=read-only` everywhere or kill the process.
- [ ] Identify the affected integration(s) and entity range.
- [ ] Pull the relevant audit log entries: `grep <integration> logs/writes-YYYY-MM-DD.ndjson | jq`.
- [ ] Count: how many writes attempted, refused, executed, errored?
- [ ] If executed writes are problematic: rollback per the plan. If no plan: stop, escalate.

## Audit log forensics

- [ ] For each suspect entry, confirm: integration, method, path, requestHash, reason, outcome.
- [ ] Cross-reference with the source code: where was this `safeWrite` called from?
- [ ] Cross-reference with deployment state: was `MODE=read-write` set deliberately?
- [ ] Cross-reference with operator activity: who/what triggered this?

## Root cause

Answer the questions:

1. What was the trigger? (cron, user action, agent loop, retry storm)
2. What sequence of checks fired? (which `reasonCode` if refused, or none if executed)
3. Was the configuration correct? (`MODE`, env vars, deployed code)
4. Was the calling code correct? (right `confirmed` / `destructive` semantics)
5. Was the guard library correct? (bug in `safeWrite` itself)

Only mark a guard-library bug if you can reproduce and write a failing test.

## Containment

- [ ] If executed writes leaked: rollback or annotate as "intentionally permanent."
- [ ] Notify downstream systems / partners / customers if their data was affected.
- [ ] Update audit log retention if forensics need a longer trail.
- [ ] Add monitoring for the specific failure mode.

## Permanent fix

- [ ] Code change addresses the root cause (not just the symptom).
- [ ] Test reproduces the incident's failure path.
- [ ] Pre-push checklist re-run.
- [ ] Documentation updated if the failure was driven by unclear docs.

## Postmortem

Write a brief postmortem with these sections:

1. **What happened** — timeline, integrations, scope.
2. **What was the impact** — data, customers, dollars, time.
3. **Why did it happen** — root cause, contributing factors, what the three keys did or didn't catch.
4. **What we changed** — code, infrastructure, process.
5. **What we'll do differently** — habits, conventions, training.

Share with the team. Anonymize for external sharing if needed.

## Don't

- ❌ Don't disable `safe-write-mode` because it "caught the wrong thing"
- ❌ Don't add a bypass mechanism
- ❌ Don't hardcode `confirmed: true` to silence repeated refusals
- ❌ Don't delete audit log entries

If the library is misbehaving, file a bug. If your code is misbehaving, fix the code.
