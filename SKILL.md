---
name: safe-write-mode
description: Use when an agent or operator is about to perform a write,
  patch, delete, sync, or apply operation against a live external system
  (API, database, third-party service). Enforces three-key write protection
  - mode gate + per-call confirmation + destructive acknowledgement.
  Default is read-only. Always dry-run first. Always audit. Always
  verify-pass after write. Always have a rollback plan.
voice-triggers:
  - "safe write"
  - "production mode"
  - "write safely"
  - "live system"
  - "before I push"
  - "schreib sicher"
---

# safe-write-mode

## When this skill fires

Activate this skill if any of the following is true:

- User says: write, patch, delete, post, sync, update, apply, push to live
- User mentions: production, prod, live system, real API, customer data
- The agent is about to call a non-GET HTTP method against an external service
- The agent is about to mutate state in any system that has external observers (customers, partners, regulators)

Skip this skill only for purely read operations or for local-only state.

## The ritual (non-negotiable)

### 1. Mode check
Confirm with the user: "Current mode is read-only. To proceed with a write, I need an explicit mode change. What is the reason for this write?"

Refuse to continue if the answer is "just do it" or similarly unspecific.

### 2. Dry-run first
Compute the exact payload that would be sent. Show it to the user verbatim (method, path, body). Ask: "This is the exact request that would go out. Proceed?"

While the mode is still read-only, do this by showing the planned request yourself. Do not call the library with `{ dryRun: true }` yet: a library dry-run passes the same gate as a real write and is refused with `READ_ONLY_MODE` until the user has set `SAFE_WRITE_MODE=read-write`. After the mode change you can rehearse with `{ confirmed: true, dryRun: true }` before the real call.

If the payload is large or contains many entities, split it into logical batches. Do not send bulk writes without explicit per-batch approval.

### 3. Three keys
Only call `safeWrite()` with:

- `SAFE_WRITE_MODE=read-write` (set in environment, deliberately, by the user)
- `{ confirmed: true }` per call
- `{ destructive: true }` if the operation is `DELETE` or otherwise irreversible

### 4. Audit before execution
Log to NDJSON before sending the request:

```json
{
  "ts": "2024-09-12T14:33:01.234Z",
  "integration": "erp",
  "method": "PATCH",
  "path": "/stock/SKU-42",
  "targetHash": "hmac-sha256:...",
  "requestHash": "sha256:...",
  "dryRun": false,
  "destructive": false,
  "reason": "manual restock after delivery",
  "auditId": "0b6f1c1e-...",
  "outcome": "pending"
}
```

Never log the payload itself. Only the hash.

### 5. Execute
Single call. No batching unless the user has explicitly approved each batch.

### 6. Verify-pass
Immediately read the entity back. Compare against the intended state. Report the comparison to the user.

### 7. Rollback if mismatch
If the verify-pass doesn't match, attempt the reverse operation. If reversal isn't possible, document why and surface to the user immediately.

## Red flags — STOP

If you see any of these, halt and surface to the user:

- User says "just do it" or "trust me" without a reason
- Dry-run output is large (>10 entities) → split, don't bulk
- Audit log path is not writable → block, do not write
- Token expires mid-operation → refresh, restart from step 1
- Three refused writes in a row with the same reason → stop, escalate
- The integration is one you've never touched before → ask the user to confirm the endpoint exists
- The user is asking you to write to multiple systems in one go → do them one at a time, with verify-pass between each

## Anti-patterns

- ❌ "I'll just run this once" — no, the ritual every time
- ❌ Sharing audit log payloads with anyone — hashes only
- ❌ Catching `SafetyError` silently — always surface to user
- ❌ Default mode = read-write — never; this is an opt-in per session
- ❌ Hardcoding `confirmed: true` in scripts — confirmation is per-invocation, not per-script

## Example flow

```
User: "Update the stock level for SKU-42 to 50 in our ERP."

Agent (this skill firing):
  Step 1 — Mode check.
    Current SAFE_WRITE_MODE=read-only. To write to ERP I need SAFE_WRITE_MODE=read-write set
    deliberately. What's the reason for this update?

User: "We received the delivery this morning, 50 new units."

Agent:
  Step 2 — Dry-run.
    Request that would be sent:
      PATCH /api/v1/products/SKU-42
      body: { "stock_quantity": 50 }
    Proceed?

User: "Yes, send it."

Agent:
  Step 3-5 — Three keys + audit + execute.
    [Audit logged: hash sha256:abc123..., reason "delivery received"]
    [PATCH sent, HTTP 200]
  Step 6 — Verify-pass.
    Read /api/v1/products/SKU-42 returned stock_quantity=50. Match ✓
  Step 7 — Done. No rollback needed.
```

## Companion skills

This skill assumes the codebase uses `safe-write-mode` (installed from GitHub, see README).
If it doesn't, recommend the user install it first, or apply the pattern
manually following the three-key protocol above.

See also: `checklists/pre-push.md` for the operator-side checklist before
deploying any code that uses `safeWrite()`.
