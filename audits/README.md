# Audits

External adversarial audits of `safe-write-mode`, kept under version control so the maturity trail stays with the code.

| Date | Round | Report | Verdict | Tested against |
|---|---|---|---|---|
| 2026-05-19 | 1 | (only filed in private memory) | 20 findings, 13 fixed | v0.1.0 (commits `e8e23f8` … `1150e7d`) |
| 2026-05-20 | 2 | [`2026-05-20-round-2.md`](2026-05-20-round-2.md) | "NICHT WASSERDICHT" — 2 CRITICAL chains + 10 HIGH + 10 MEDIUM + 8 LOW. All publish-blockers fixed in v0.2.0 (commit `ecc4018`). | v0.1.0 post-r1 (`1150e7d`) |

## Process

1. Reviewer audits the current `main` HEAD adversarially. Standard SAST is part of the pass but not the whole pass — semantic threat-model analysis is where every CRITICAL has come from so far.
2. Reviewer files the report as a PR under `audits/YYYY-MM-DD-round-N.md`.
3. Maintainer reads, opens fix issues, lands fixes with regression coverage in `test/audit-fixes-rN.test.js`.
4. After the next major behavior change, the next round starts.

## Tool baseline used in round 2

- gitleaks v8.30.1
- trivy v0.70.0
- semgrep v1.162.0 with rules: `p/javascript + p/nodejs + p/security-audit + p/owasp-top-ten` (91 rules total)

All three returned 0 findings against v0.1.0 post-r1. Every finding in round 2 came from human semantic review — for future rounds, assume SAST is necessary but not sufficient.

## Discovery candidates (proposed new patterns)

From round 2:
- **SWM-INTERNAL-SYMBOL-EXPORT** (HIGH): "Internal capability tokens MUST NOT be exported from a security boundary." Symbol-based markers that signal trust to a downstream guard are themselves a bypass surface once they cross the public-API line.
- **INJ-AUDIT-PRE-HASH-DOS** (LOW-MEDIUM): canonical-stringify without cycle detection and depth cap can suppress the audit-log entry that the guarded operation would otherwise write.
