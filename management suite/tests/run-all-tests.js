/**
 * Master Test Runner for Vishwa Atelier Management Suite
 * Uses Node.js native test runner (zero external dependencies).
 */

const { spawn } = require('node:child_process');
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
  path.join(__dirname, 'yarn-concurrency.test.js')
];

const runner = spawn(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..')
});

runner.on('close', (code) => {
  console.log('\n====================================================');
  if (code === 0) {
    console.log('✅ ALL TEST SUITES PASSED (100% SUCCESS)');
  } else {
    console.log(`❌ TEST SUITE FAILED with exit code ${code}`);
  }
  console.log('====================================================');
  process.exit(code);
});
