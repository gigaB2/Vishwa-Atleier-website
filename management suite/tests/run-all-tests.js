/**
 * Master Test Runner for Vishwa Atelier Management Suite
 * Uses Node.js native test runner (zero external dependencies).
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

console.log('====================================================');
console.log('🧪 VISHWA ATELIER MANAGEMENT SUITE — TEST RUNNER');
console.log('====================================================\n');

const testFiles = [
  path.join(__dirname, 'fy-engine.test.js'),
  path.join(__dirname, 'sync-engine.test.js'),
  path.join(__dirname, 'costing-math.test.js'),
  path.join(__dirname, 'presence-engine.test.js'),
  path.join(__dirname, 'yarn-ledger-gr.test.js'),
  path.join(__dirname, 'yarn-ledger-regression.test.js'),
  path.join(__dirname, 'yarn-concurrency.test.js'),
  path.join(__dirname, 'weaving-orders-sync.test.js'),
  path.join(__dirname, 'design-library-sync-delete.test.js'),
  path.join(__dirname, 'test-postgres-error-safeguards.js'),
  path.join(__dirname, 'auth-settings-sync.test.js'),
  path.join(__dirname, 'auth-adapter.test.js'),
  path.join(__dirname, 'rls-hardening.test.js'),
  path.join(__dirname, 'supabase-error-audit.test.js'),
  path.join(__dirname, 'characterization-e2e.test.js'),
  path.join(__dirname, 'relational-migration-e2e.test.js')
];

const scriptTests = [
  path.join(__dirname, 'vf-db-service.test.js'),
  path.join(__dirname, 'verify-all-pages.test.js'),
  path.join(__dirname, 'dom-hardening.test.js'),
  path.join(__dirname, 'secret-hygiene.test.js'),
  path.join(__dirname, 'backup-restore-safety.test.js'),
  path.join(__dirname, 'public-website-perf.test.js'),
  path.join(__dirname, 'accessibility-seo.test.js'),
  path.join(__dirname, 'security-headers.test.js'),
  path.join(__dirname, 'gear-math-engine.test.js')
];

let failed = 0;
for (const file of testFiles) {
  const rel = path.relative(path.join(__dirname, '..'), file);
  const res = spawnSync(process.execPath, ['--test', file], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  if (res.status !== 0) {
    console.error(`\n❌ Failed: ${rel}\n`);
    failed++;
  }
}

for (const file of scriptTests) {
  const rel = path.relative(path.join(__dirname, '..'), file);
  const res = spawnSync(process.execPath, [file], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  if (res.status !== 0) {
    console.error(`\n❌ Failed: ${rel}\n`);
    failed++;
  }
}

console.log('\n====================================================');
if (failed === 0) {
  console.log('✅ ALL TEST SUITES PASSED (100% SUCCESS)');
  process.exit(0);
} else {
  console.log(`❌ ${failed} TEST SUITE(S) FAILED`);
  process.exit(1);
}
