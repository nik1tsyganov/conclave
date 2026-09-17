// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
const fs = require('fs');
const path = require('path');

function run() {
  let logPath = path.join(__dirname, '../telemetry/dispatches.jsonl');
  let outputJson = false;

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--log' && args[i + 1]) {
      logPath = args[i + 1];
      i++;
    } else if (args[i] === '--json') {
      outputJson = true;
    }
  }

  if (!fs.existsSync(logPath)) {
    process.stderr.write('NO LOG\n');
    process.exit(2);
  }

  const content = fs.readFileSync(logPath, 'utf8').trim();
  if (!content) {
    if (outputJson) {
      console.log(JSON.stringify({ captureHealth: { rowCount: 0, finding: "FINDING: zero rows" } }));
    } else {
      console.log("Capture Health: 0 rows (FINDING: zero rows)");
    }
    process.exit(0);
  }

  const lines = content.split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (err) {
      process.exit(1);
    }
  }

  let capturedByLead = 0;
  let missingCapturedBy = 0;

  const vendorByRole = {
    implement: {},
    verify: {},
    review: {}
  };

  const hostModes = {};

  let vendorSideTokensSum = 0;
  let vendorSideTokensCount = 0;
  let totalTokensSum = 0;
  let totalTokensCount = 0;

  for (const row of rows) {
    if (row.capturedBy === 'lead') capturedByLead++;
    else if (!row.capturedBy) missingCapturedBy++;

    if (row.role && vendorByRole[row.role] !== undefined && row.vendor) {
      vendorByRole[row.role][row.vendor] = (vendorByRole[row.role][row.vendor] || 0) + 1;
    }

    if (row.hostMode) {
      hostModes[row.hostMode] = (hostModes[row.hostMode] || 0) + 1;
    }

    if (typeof row.vendorSideTokens === 'number') {
      vendorSideTokensSum += row.vendorSideTokens;
      vendorSideTokensCount++;
    }
    if (typeof row.totalTokens === 'number') {
      totalTokensSum += row.totalTokens;
      totalTokensCount++;
    }
  }

  const stats = {
    captureHealth: {
      rowCount: rows.length,
      capturedByLead,
      missingCapturedBy
    },
    vendorShare: vendorByRole,
    tokens: {
      vendorSideTokens: {
        count: vendorSideTokensCount,
        sum: vendorSideTokensSum,
        mean: vendorSideTokensCount > 0 ? vendorSideTokensSum / vendorSideTokensCount : null
      },
      totalTokens: {
        count: totalTokensCount,
        sum: totalTokensSum,
        mean: totalTokensCount > 0 ? totalTokensSum / totalTokensCount : null
      }
    },
    hostMode: hostModes
  };

  if (outputJson) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log(`Capture Health:\n  Rows: ${stats.captureHealth.rowCount}\n  Captured by lead: ${stats.captureHealth.capturedByLead}\n  Missing capturedBy: ${stats.captureHealth.missingCapturedBy}`);
  console.log("DECISION: if zero rows, telemetry capture is broken. if missing capturedBy > 0, arbiter needs fixing.");

  console.log("\nVendor Share by Role:");
  for (const role of ['implement', 'verify', 'review']) {
    console.log(`  ${role}:`);
    const totalForRole = Object.values(stats.vendorShare[role]).reduce((a, b) => a + b, 0);
    for (const [vendor, count] of Object.entries(stats.vendorShare[role])) {
      const pct = totalForRole > 0 ? (count / totalForRole * 100).toFixed(1) : 0;
      console.log(`    ${vendor}: ${count} (${pct}%)`);
    }
  }
  console.log("DECISION: if one vendor >60% implement, activation-check will fail.");

  console.log("\nTokens:");
  console.log(`  vendorSideTokens - count: ${stats.tokens.vendorSideTokens.count}, sum: ${stats.tokens.vendorSideTokens.sum}, mean: ${stats.tokens.vendorSideTokens.mean !== null ? stats.tokens.vendorSideTokens.mean.toFixed(1) : 'null'}`);
  console.log(`  totalTokens - count: ${stats.tokens.totalTokens.count}, sum: ${stats.tokens.totalTokens.sum}, mean: ${stats.tokens.totalTokens.mean !== null ? stats.tokens.totalTokens.mean.toFixed(1) : 'null'}`);
  console.log("DECISION: if null-token rate high, cost tracking is ineffective.");

  console.log("\nHost Mode Breakdown:");
  for (const [mode, count] of Object.entries(stats.hostMode)) {
    console.log(`  ${mode}: ${count}`);
  }
  console.log("DECISION: if cursor-cli drops to 0, host agent updates broke integration.");
}

run();
