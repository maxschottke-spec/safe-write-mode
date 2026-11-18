'use strict';

// A command-line tool of the kind you hand to an AI agent instead of letting
// it call an API directly. The agent runs it through its shell tool; every
// write goes through the gate.
//
//   node examples/agent-tool.js get SKU-42
//   node examples/agent-tool.js set SKU-42 50 --confirm --reason "delivery received"
//   SAFE_WRITE_MODE=read-write node examples/agent-tool.js set SKU-42 50 --confirm --reason "delivery received"
//
// Output is one JSON object on stdout. Exit code 0 = done, 2 = refused by the
// gate, 1 = anything else. The "system" is a JSON file in the temp directory,
// so the example needs no network and no account.
//
// In your own project: copy this file and require('safe-write-mode') instead.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createIntegration, defineAdapter, lockMode, SafetyError } = require('../src');

// Freeze the mode before anything else runs. Whatever the environment says
// now is what this process keeps.
lockMode();

// ── Stand-in for the remote system. Replace with your real HTTP client. ────
const STORE = process.env.AGENT_TOOL_STORE || path.join(os.tmpdir(), 'safe-write-mode-demo-stock.json');
const load = () => (fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : { 'SKU-42': 42 });
const client = defineAdapter({
  label: 'demo-erp',
  async get(p) {
    const sku = p.split('/').pop();
    return { status: 200, body: { sku, qty: load()[sku] ?? null } };
  },
  async write(method, p, body) {
    const sku = p.split('/').pop();
    const stock = load();
    stock[sku] = body.qty;
    fs.writeFileSync(STORE, JSON.stringify(stock));
    return { status: 200, body: { sku, qty: body.qty } };
  },
});
const erp = createIntegration({ name: 'demo-erp', client });

// ── Command line ───────────────────────────────────────────────────────────
function parse(argv) {
  const reasonAt = argv.indexOf('--reason');
  const [command, sku, qty] = argv.filter((a, i) => !a.startsWith('--') && (reasonAt === -1 || i !== reasonAt + 1));
  const flag = (name) => argv.includes(`--${name}`);
  return {
    command, sku, qty: Number(qty),
    confirm: flag('confirm'), dryRun: flag('dry-run'),
    reason: reasonAt === -1 ? null : argv[reasonAt + 1],
  };
}

async function main() {
  const a = parse(process.argv.slice(2));
  if (a.command === 'get' && a.sku) {
    return (await erp.read.get(`/stock/${a.sku}`)).body;
  }
  if (a.command === 'set' && a.sku && Number.isFinite(a.qty)) {
    // `confirmed` comes from this invocation's --confirm flag. It is not
    // hardcoded: a call without the flag is refused and logged.
    const result = await erp.write.patch(`/stock/${a.sku}`, { qty: a.qty }, {
      confirmed: a.confirm, reason: a.reason, requireReason: true, dryRun: a.dryRun,
    });
    if (result.dryRun) return { dryRun: true, wouldSend: { method: 'PATCH', path: `/stock/${a.sku}`, body: { qty: a.qty } } };
    // Verify: read the value back instead of trusting the write's response.
    const after = (await erp.read.get(`/stock/${a.sku}`)).body;
    return { written: true, verified: after.qty === a.qty, after };
  }
  throw new Error('usage: agent-tool.js get <sku> | set <sku> <qty> [--confirm] [--dry-run] --reason "<why>"');
}

main().then(
  (out) => { console.log(JSON.stringify(out)); },
  (err) => {
    if (err instanceof SafetyError) {
      // Tell the agent what happened and that it must not work around it.
      console.log(JSON.stringify({
        refused: true, code: err.code, message: err.message,
        next: 'Nothing was sent. Do not retry with different flags; report this to the user.',
      }));
      process.exit(2);
    }
    console.error(err.message);
    process.exit(1);
  },
);
