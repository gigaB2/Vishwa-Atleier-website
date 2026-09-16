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
  path.join(__dirname, 'yarn-concurrency.test.js'),
  path.join(__dirname, 'weaving-orders-sync.test.js'),
  path.join(__dirname, 'design-library-sync-delete.test.js'),
  path.join(__dirname, 'test-postgres-error-safeguards.js')
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

console.log('\n====================================================');
if (failed === 0) {
  console.log('✅ ALL TEST SUITES PASSED (100% SUCCESS)');
  process.exit(0);
} else {
  console.log(`❌ ${failed} TEST SUITE(S) FAILED`);
  process.exit(1);
}
