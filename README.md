# safe-write-mode

> A write gate for AI agents and scripts that talk to live systems. Read-only by default, zero dependencies, Node.js.

**The problem:** an agent or script that holds an API token can change or delete live data by accident, for example in a loop, in the wrong environment, or because a "test" call was real.
**What this does:** you wrap your HTTP calls once; after that reads always work, and a write is only sent when the process was started with `SAFE_WRITE_MODE=read-write`, the call says `confirmed: true`, and a delete also says `destructive: true`. Every attempt, refused or sent, is appended to a local audit log.
**What it is not:** a security boundary. Code in the same process can set all of these itself. It stops accidents, not an attacker, and it only sees calls that you route through it. See [Limits](#limits-read-before-you-install).

**For:** people who let Claude Code or another agent, a cron job, or their own scripts call an ERP, shop, CMS or payment API with a token that is allowed to write.

```js
const { createIntegration, defineAdapter } = require('safe-write-mode');
const client = defineAdapter({ label: 'erp', get: myGet, write: myWrite });   // your HTTP calls, wrapped once
const erp = createIntegration({ name: 'erp', client });

await erp.read.get('/stock/SKU-42');                                          // always allowed
await erp.write.patch('/stock/SKU-42', { qty: 50 }, { confirmed: true });     // SafetyError READ_ONLY_MODE,
                                                                              // unless SAFE_WRITE_MODE=read-write
await erp.write.delete('/stock/SKU-42', { confirmed: true, destructive: true });   // DELETE needs both flags
// each attempt is logged to ./logs/writes-YYYY-MM-DD.ndjson, with a hash of the body instead of the body
```

[Quickstart](#quickstart-five-minutes-no-account-needed) · [Limits](#limits-read-before-you-install) · [Install](#install) · [Using it with an AI agent](#using-it-with-an-ai-agent) · [What has been verified](#what-has-been-verified)

## Quickstart (five minutes, no account needed)

**You need:** Node.js 22 or newer (`node --version`), npm, and git (npm fetches the package from GitHub). Nothing else is installed: the library has no dependencies. The commands are written for macOS and Linux shells; see [Requirements](#requirements) for Windows.

```bash
mkdir swm-try && cd swm-try
npm init -y
npm install github:maxschottke-spec/safe-write-mode#v0.2.2

# 1. Default mode: the write is refused.
node node_modules/safe-write-mode/examples/three-key-write.js

# 2. Same file, mode set for this one command: the write goes through.
SAFE_WRITE_MODE=read-write node node_modules/safe-write-mode/examples/three-key-write.js

# 3. Both attempts are in the audit log.
cat logs/writes-*.ndjson
```

Step 1 ends with `Refused by SafetyError: READ_ONLY_MODE`. Step 2 prints `Dry-run result`, then `Live result` with `status: 200`, then `DELETE refused: DESTRUCTIVE_NOT_ACKED`, because that call leaves out `destructive: true` on purpose. The example talks to a stand-in inside the file, not to a network.

The lines that start with `{"ts":` are the console log on stderr. `LOG_LEVEL=error` hides them.

### Your own first file

Save this as `first.js` in the same folder. `myHttp` is a stand-in; later you put your real HTTP client there.

```js
// first.js
const { createIntegration, defineAdapter } = require('safe-write-mode');

// Stand-in for your real HTTP client. get/write must return a promise;
// if the result has a numeric `status`, it lands in the audit log.
const myHttp = {
  get: async (path) => ({ status: 200, body: { path, qty: 42 } }),
  request: async (method, path, body) => {
    console.log('SENT', method, path);   // you only see this line when a write really went out
    return { status: 200, body: { method, path, body } };
  },
};

// Wrap your client once. Hand-rolled clients are refused.
const erpClient = defineAdapter({
  label: 'erp',
  get: (path, opts) => myHttp.get(path, opts),
  write: (method, path, body, opts) => myHttp.request(method, path, body, opts),
});

async function main() {
  const erp = createIntegration({
    name: 'erp',
    client: erpClient,
    // readOnly: true,   // → no .write property exists at all
  });

  // Reads always work.
  console.log(await erp.read.get('/stock/SKU-42'));

  // Writes require three keys + explicit mode.
  await erp.write.patch('/stock/SKU-42', { qty: 50 }, {
    confirmed: true,
    reason: 'manual restock after delivery',
  });

  // DELETE additionally requires destructive: true.
  await erp.write.delete('/stock/SKU-42', {
    confirmed: true,
    destructive: true,
    reason: 'SKU discontinued',
  });
}

main().catch((err) => { console.error(err.code, err.message); process.exit(1); });
```

```bash
node first.js                              # prints the read, then: READ_ONLY_MODE Refused: write blocked …
SAFE_WRITE_MODE=read-write node first.js   # prints the read, then SENT PATCH … and SENT DELETE …
```

The test suite runs this block as printed, with only the `require` path pointed at the source (`test/fixes-0.2.1.test.js`).

### Check the result

The audit log is `./logs/writes-YYYY-MM-DD.ndjson` (UTC date, one JSON object per line; another folder with `WRITE_LOG_DIR`). A refused attempt looks like this:

```json
{"ts":"2026-11-18T12:19:32.636Z","integration":"erp","method":"PATCH","path":"/stock/SKU-42",
 "targetHash":"hmac-sha256:6455…","requestHash":"sha256:674a…","dryRun":false,"destructive":false,
 "reason":"manual restock after delivery","outcome":"refused","reasonCode":"READ_ONLY_MODE"}
```

- `outcome` is `refused` (with `reasonCode`), `dry-run`, or the pair `pending` and then `ok` or `error`. `pending` is written before your client is called, so **every request that was handed to your client has a `pending` line**.
- To check that nothing went out in read-only mode, send one run into a log folder of its own and count the `pending` lines:

  ```bash
  WRITE_LOG_DIR=check node first.js
  grep -c '"outcome":"pending"' check/writes-*.ndjson   # prints 0; the SENT line of the stand-in did not appear either
  ```
- `requestHash` is a SHA-256 of the body, `targetHash` a keyed hash of path plus query string. Bodies and query strings are not logged. `path`, `reason` and error messages are logged as given, so keep secrets out of them.
- The log only knows about calls that went through this library. For a real system, also read the value back or check the vendor's own log.

Field reference: [`docs/audit-trail.md`](docs/audit-trail.md).

## Limits (read before you install)

- **Not a security boundary.** `confirmed` and `destructive` are set by the caller, and a process can change its own environment. An agent that can run arbitrary code or shell commands can set all three keys. For a real boundary use a read-only API token at the vendor; `lockMode()` and `setConfirmationVerifier()` (below) narrow the gap inside the process.
- **Only what you route through it.** Calls made with `curl`, another HTTP client, a vendor SDK or an agent's MCP tools never reach the gate and are neither blocked nor logged.
- **A dry-run needs `read-write` mode too.** It passes the same gate. In the default mode a rehearsal is refused like a write.
- **Destructive paths are a heuristic.** `DELETE` always needs `destructive: true`. For other methods the path list catches `/reset`, `/purge`, `/wipe`, `/clear`, `/flush`, `/destroy`, `/factory-reset`. It does not catch `/truncate`, `/reset_all`, encoded paths or `?_method=DELETE`.
- **The audit log is not tamper-proof.** A process that can write the file can also edit it.
- **DNS rebinding** is not covered by the SSRF guard of the optional `request()` helper, and `request()` cannot reach `localhost` or private addresses at all.
- **No vendor SDKs, no payload logging, no "just this once" override.** You bring the HTTP client (skeletons in [`adapters/`](adapters/)). A read-only integration has no `.write` property at all.
- **Young project.** Version 0.2.2, one maintainer, API may change before 1.0, no outside users have reported back yet. See [What has been verified](#what-has-been-verified).

Full threat model: [`SECURITY.md`](SECURITY.md).

## Requirements

| | |
|---|---|
| Node.js | 22 or newer (uses global `fetch` and `node:dns/promises`) |
| Dependencies | none at runtime, none for development |
| Module format | CommonJS (`require`); from an ES module use `import swm from 'safe-write-mode'` |
| Ran on | macOS with Node 22 (maintainer machine), Ubuntu with Node 22 and 24 (CI) |
| Not tried | Windows. The library uses no shell, but the inline form `SAFE_WRITE_MODE=read-write node …` and the `npm run example:*` scripts are POSIX syntax. In PowerShell set the variable first, for example `$env:SAFE_WRITE_MODE='read-write'; node first.js` (not tried either) |
| Browser | no (needs `node:fs`) |

## Install

### As a library in your project

```bash
npm install github:maxschottke-spec/safe-write-mode#v0.2.2
```

The package is not on the npm registry. Install from GitHub and pin a tag, as above. Then wrap your client as in [`first.js`](#your-own-first-file); for real HTTP calls start from a skeleton in [`adapters/`](adapters/).

TypeScript: hand-written type definitions ([`index.d.ts`](index.d.ts)) are in this repository. They are **not part of the v0.2.2 tag** and ship with the next release.

### As a skill for Claude Code

[`SKILL.md`](SKILL.md) is a text file with instructions for the agent. Copy it into a skill folder of the project in which the agent works:

```bash
mkdir -p .claude/skills/safe-write-mode
cp node_modules/safe-write-mode/SKILL.md .claude/skills/safe-write-mode/SKILL.md
```

For all your projects use `~/.claude/skills/safe-write-mode/SKILL.md` instead. The skill alone protects nothing; read the next section.

### To work on the library itself

```bash
git clone https://github.com/maxschottke-spec/safe-write-mode.git
cd safe-write-mode
npm test                  # no install step needed
npm run example:basic     # also: example:write, example:dry-run, example:multi-tenant, example:agent
```

## Using it with an AI agent

Two separate things are in this repository, and you need both:

| | What it is | What it does not do |
|---|---|---|
| **The library** | Code. Refuses and logs writes that go through it. | It cannot see calls that bypass it. |
| **`SKILL.md`** | Instructions for Claude Code: ask for the reason, show the request first, use the three keys, read the value back, plan the rollback. | It enforces nothing and installs nothing. The agent follows it or not. |

What you have to do yourself:

1. **Give the agent scripts, not the API.** Write small command-line tools that wrap your API through this library, and let the agent call those. [`examples/agent-tool.js`](examples/agent-tool.js) is a complete one (about 90 lines, no network): `get` reads, `set` writes through the gate, `--confirm` becomes `confirmed: true` for that one invocation, the result is one line of JSON, exit code 2 means "refused".
2. **Keep the mode in your hands.** Do not put `SAFE_WRITE_MODE=read-write` in a profile, `.env` or agent configuration. Do not pre-approve commands that set it.
3. **Keep the token away from everything else.** If the agent can also reach the API with `curl`, a vendor MCP server or its own code, the gate is bypassed. Where the vendor offers it, give the agent a read-only token and keep the writing token for the scripts you start yourself.

In a clone of this repository:

```bash
node examples/agent-tool.js get SKU-42
# {"sku":"SKU-42","qty":42}

node examples/agent-tool.js set SKU-42 50 --confirm --reason "delivery received"
# {"refused":true,"code":"READ_ONLY_MODE","message":"Refused: write blocked because SAFE_WRITE_MODE=read-only (demo-erp PATCH /stock/SKU-42).","next":"Nothing was sent. Do not retry with different flags; report this to the user."}
# exit code 2

SAFE_WRITE_MODE=read-write node examples/agent-tool.js set SKU-42 50 --confirm --reason "delivery received"
# {"written":true,"verified":true,"after":{"sku":"SKU-42","qty":50}}
```

The stand-in "system" is a JSON file in your temp directory. `examples/agent-tool.js` is in the repository but **not in the v0.2.2 package**; until the next release, clone the repository or copy the file, and in your own project change `require('../src')` to `require('safe-write-mode')`.

**Not covered, even with all of this:**

- MCP tools, web requests and shell commands of the agent that do not go through your scripts.
- An agent that edits the script, sets `--confirm` on its own, or sets the mode itself because its host lets it run any command. The library then still forces an explicit step and logs it, but it does not stop it.
- Whether the agent follows the skill. In the three recorded runs below it did; that is an observation, not a guarantee.

## The three keys

A write is only sent if **all three** are present:

1. **`SAFE_WRITE_MODE=read-write`** in the environment (legacy `MODE=read-write` is honored with a deprecation warning). Default is `read-only`.
2. **`{ confirmed: true }`** as a per-call option. Forces the caller to acknowledge that this specific operation is intentional. Only the boolean `true` counts; `'true'`, `'false'` or `1` are refused.
3. **`{ destructive: true }`** for `DELETE` (and any operation matching the destructive-path patterns, e.g. `/reset`, `/purge`, `/wipe`).

Plus: **`{ dryRun: true }`** lets you rehearse the call without sending it. A rehearsal passes the same gate, so it also needs `SAFE_WRITE_MODE=read-write` and `{ confirmed: true }`. The audit-log records the rehearsal.

## What's in the box

| Module | Purpose |
|---|---|
| `safeWrite()` | Core write gate with audit logging |
| `createIntegration()` | Factory that gives you `.read` and (optionally) `.write` surfaces |
| `request()` | HTTP client with retry-after, backoff+jitter, redirect-auth guard, timeout |
| `logger` | Append-only NDJSON audit + structured console log |
| `env` | `required()` / `optional()` / `requiredJsonBase64()` helpers |
| `SafetyError` | Typed error with `code`: `READ_ONLY_MODE`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_REJECTED`, `DESTRUCTIVE_NOT_ACKED`, `REASON_REQUIRED`, `INVALID_MODE`, `INVALID_METHOD`, `INVALID_PATH`, `AUDIT_UNAVAILABLE`, `MODE_LOCKED`, `VERIFIER_LOCKED`, `BODY_CYCLE`, `BODY_TOO_DEEP`, `TEST_HOOKS_DISABLED` |

## Locking the mode and adding a real confirmation

```js
const { lockMode, setConfirmationVerifier } = require('safe-write-mode');

lockMode();   // freezes the current mode; later changes to the environment are ignored

setConfirmationVerifier(async ({ integration, method, path, requestHash, destructive, reason, confirmationToken }) => {
  return await askHostProcess(confirmationToken);   // must return exactly true
});

// per call: { confirmed: true, confirmationToken: '…' }
```

A refusal or an exception in the verifier ends in a `SafetyError` with code `CONFIRMATION_REJECTED`. Dry-runs pass the verifier too. Both calls are one-way: locking a different mode later throws `MODE_LOCKED` (repeating the locked mode is allowed), and installing a second verifier or removing the first throws `VERIFIER_LOCKED`. If the audit log is not writable, any refusal is reported as `AUDIT_UNAVAILABLE` with the original code in `err.reasonCode`.

## Environment variables

| Variable | Effect |
|---|---|
| `SAFE_WRITE_MODE` | `read-only` (default) or `read-write`. Legacy `MODE` is still read, with a warning. |
| `WRITE_LOG_DIR` | Directory of the audit log, default `./logs`. If it is not writable, every write is refused. |
| `SAFE_WRITE_REQUIRE_REASON` | `1` or `true` makes a non-empty `reason` mandatory for every write. |
| `SAFE_WRITE_AUDIT_KEY` | Key for `targetHash` in the audit log. Read once at load, then removed from `process.env`. Without it a random key per process is used. |
| `SAFE_WRITE_ALLOW_INSECURE` | `1` lets `request()` use `http:`. Loopback and private addresses stay blocked. |
| `SAFE_WRITE_SKIP_DNS_CHECK` | `1` skips the DNS lookup of the SSRF guard in `request()`. |
| `LOG_LEVEL` | `error`, `warn`, `info` (default) or `debug` for the console log. |
| `SAFE_WRITE_TEST_HOOKS` | `1` enables the test hooks, and only if set before the library is first loaded. Only for this library's own test suite. |

The library reads `process.env` only; it does not load `.env` files. [`.env.example`](.env.example) is a commented starting point for `node --env-file=.env your-script.js`.

## Checklists

- [`checklists/pre-push.md`](checklists/pre-push.md) — 8-point gate before you push a write-enabled change
- [`checklists/guardrail-review.md`](checklists/guardrail-review.md) — skeptical-senior-operator prompt for plans involving writes
- [`checklists/post-incident.md`](checklists/post-incident.md) — what to do after a `SafetyError` fires in production

## What has been verified

Three different levels, kept apart on purpose:

**1. Automated tests** (`npm test`, run by CI on Ubuntu with Node 22 and 24 for every push to `main`):
the gate and its refusal codes, mode lock and verifier, audit log contents, the SSRF and path guards of `request()`, the `first.js` block of this README as printed, all five examples including `agent-tool.js` (read, refused write, dry-run, allowed write, read-back), and that `index.d.ts` declares exactly the names the library exports. The tests compare names of the type definitions, not their signatures.

**2. Checked in a real Claude Code session** (2026-11-18, Claude Code 2.1.327 on macOS, three non-interactive `claude -p` runs in a throwaway project with `SKILL.md` as a project skill and `examples/agent-tool.js` as `tools/stock.js`, built-in tools limited to Read, Skill and Bash, no MCP servers):

- The skill was loaded in all three runs without being named. The prompts asked to set the stock of SKU-42 to 50 in a demo ERP through `tools/stock.js`. Model: `claude-fable-5-2`.
- Run 1, only `node tools/stock.js` allowed: the agent read the stock, tried a dry-run, got `READ_ONLY_MODE`, did not set the mode itself and asked the user to run or approve the read-write command.
- Run 2, same permissions, prompt contains the user's approval: the agent tried `SAFE_WRITE_MODE=read-write node tools/stock.js set …`; Claude Code answered "This command requires approval" (only the plain `node tools/stock.js` command was on the allow list). Nothing was written.
- Run 3, the read-write command allowed as well: the write went through (`pending` and `ok` in the audit log), and the agent read the value back.
- In every run the agent passed `--confirm` itself; that flag was never the barrier. The mode was.
- In every run the first dry-run was refused, because the skill asks for a dry-run before the mode is set and the library needs the mode for a dry-run. That friction is open.

These are three runs with one model and one task. Other prompts, models, permission settings or agent hosts were not tried.

**3. Confirmed by external users:** nothing yet. If you try it, a short note in an issue, also when it did not work, is the most useful contribution right now.

Also not verified here: Windows, real vendor APIs (this repository contains only stand-ins and adapter skeletons), the user-level skill folder `~/.claude/skills`, and installing with package managers other than npm.

## Status

v0.2.2. Reviewed adversarially by AI agents in three rounds (multi-agent review plus gitleaks, trivy and semgrep in round 2); the round-2 report is in [`audits/`](audits/), rounds 3 and later are summarised in [`CHANGELOG.md`](CHANGELOG.md), and round 1 is not published. No third-party human audit. The pattern is stable, the API may change before v1.0.

Developed for and used in one operator's e-commerce stack. Those integrations are not published, so this repository contains no evidence of that use; what you can check here are the tests and the examples.

**Breaking change v0.1 → v0.2:** The internal-write symbol `__INTERNAL_WRITE__` is no longer exported. Build adapter clients via `defineAdapter({ label, get, write })` and pass them to `createIntegration({ client })`. Hand-rolled clients are refused. See `examples/three-key-write.js` for the new shape.

## Contributing and questions

Bug reports and questions: [open an issue](https://github.com/maxschottke-spec/safe-write-mode/issues/new/choose). Security problems: not in a public issue, see [`SECURITY.md`](SECURITY.md). How to contribute: [`CONTRIBUTING.md`](CONTRIBUTING.md). More background: [`docs/philosophy.md`](docs/philosophy.md), [`docs/three-key-protection.md`](docs/three-key-protection.md), [`docs/faq.md`](docs/faq.md).

## License

MIT. See [LICENSE](LICENSE).
