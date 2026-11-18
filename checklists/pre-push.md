# Pre-Push Checklist

Run this before pushing any code that uses `safeWrite()` to a shared branch.

## 1. Mode discipline

- [ ] No `SAFE_WRITE_MODE=read-write` hardcoded anywhere in source. Only in deliberate `.env` files or session-level shell invocations.
- [ ] No `confirmed: true` hardcoded at the client wrapper level. It must come from the call site.
- [ ] No `destructive: true` defaulted to `true` anywhere.

## 2. Audit log

- [ ] `WRITE_LOG_DIR` is configured for the deployment target. Default `./logs` works locally; production needs a real path.
- [ ] Audit log directory is writable by the process.
- [ ] Audit log rotation/shipping is in place (or noted in the PR as out-of-scope).
- [ ] No PII or secrets appear in `reason` strings.

## 3. Tests

- [ ] Every new write has a test that exercises the refused path (no `confirmed`).
- [ ] Every new DELETE has a test that exercises the `DESTRUCTIVE_NOT_ACKED` refusal.
- [ ] Tests do not actually hit live APIs. Use the `execute` callback to inject a fake.
- [ ] `npm test` passes.

## 4. Dry-run readiness

- [ ] Every new write can be exercised with `dryRun: true` and produces a meaningful audit entry.
- [ ] An operator could safely run the script with `SAFE_WRITE_MODE=read-write` and `dryRun: true` to rehearse without consequences.

## 5. Code review

- [ ] At least one reviewer has eyes on the diff.
- [ ] The reviewer specifically looked at the call sites for `safeWrite` / `integration.write.*`.
- [ ] `reason` strings make sense to someone six months from now.

## 6. Rollback plan

- [ ] For each new write, you can answer: "If this fires once incorrectly, how do I reverse it?"
- [ ] If the answer is "I can't" — verify `destructive: true` is set and the operation is justified.

## 7. Secrets and config

- [ ] `.env` is in `.gitignore`. Verify with `git ls-files | grep -E '^\.env'`.
- [ ] Any new env vars are documented in the README or an `.env.example`.
- [ ] `gitleaks` and `trufflehog` pass with no findings on the diff.

## 8. Deployment

- [ ] Deployment target has `SAFE_WRITE_MODE=read-only` by default unless this branch is the explicit write path.
- [ ] Monitoring/alerting is configured for `SafetyError` events.
- [ ] Audit log volume is monitored.

## Output

If any box is unchecked, fix it before pushing. If a box doesn't apply, mark it `N/A` with a one-line reason in the PR description.
