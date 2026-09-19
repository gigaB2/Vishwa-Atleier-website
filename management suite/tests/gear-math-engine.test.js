/**
 * Phase 10 (Step 1): Gear Math Engine Unit Test Suite
 * Zero external dependencies — runs directly in Node.js test runner or standalone.
 */

const assert = require('node:assert');
const path = require('node:path');
const GearMath = require('../assets/gear-math-engine.js');

console.log('--- Phase 10: Textile Gear Math Engine Test Suite ---');

// Test 1: 4-Gear train ratio
const ratio = GearMath.calculateGearRatio(60, 35, 55, 40);
assert(Math.abs(ratio - 2.357142857) < 0.0001, `Ratio mismatch: got ${ratio}`);
assert.strictEqual(GearMath.calculateGearRatio(60, 0, 55, 40), 0, 'Zero driver A must return 0');
assert.strictEqual(GearMath.calculateGearRatio(60, 35, 55, 0), 0, 'Zero driver C must return 0');
console.log('  ✓ calculateGearRatio computes 4-gear ratio and handles zero divisors safely');

// Test 2: Nominal TFO / Covering TPM
const tfoTpm = GearMath.calculateTfoTpm(874.2, 35, 60, 40, 55);
assert(Math.abs(tfoTpm - 2060.614) < 0.01, `TFO TPM mismatch: got ${tfoTpm}`);
assert.strictEqual(GearMath.calculateTfoTpm(0, 35, 60, 40, 55), 0, 'Zero machine constant must return 0');
console.log('  ✓ calculateTfoTpm computes nominal TPM matching golden factory values');

// Test 3: Actual delivered TPM adjusted for slip and contraction
const actualTpm = GearMath.calculateActualTpm(2000, 2, 3);
const expectedActual = (2000 * 0.98) / 0.97;
assert(Math.abs(actualTpm - expectedActual) < 0.0001, `Actual TPM mismatch: got ${actualTpm}`);
assert.strictEqual(GearMath.calculateActualTpm(2000, 0, 0), 2000, 'Zero slip and contraction must preserve nominal TPM');
assert.strictEqual(GearMath.calculateActualTpm(2000, 2, 100), 2000, '100% contraction boundary must avoid division by zero');
console.log('  ✓ calculateActualTpm calculates yarn contraction and spindle slip adjustments');

// Test 4: Doubler gearing and TPM
const doublerRatio = GearMath.calculateDoublerRatio(40, 60);
assert(Math.abs(doublerRatio - (2/3)) < 0.0001, `Doubler ratio mismatch: got ${doublerRatio}`);
assert.strictEqual(GearMath.calculateDoublerRatio(40, 0), 0, 'Zero shaft gear must return 0');

const doublerTpm = GearMath.calculateDoublerTpm(450, 40, 60);
assert(Math.abs(doublerTpm - 300.0) < 0.0001, `Doubler TPM mismatch: got ${doublerTpm}`);
console.log('  ✓ calculateDoublerTpm computes doubling twist accurately');

// Test 5: Weaving loom picks per inch/cm
const picks = GearMath.calculatePicks(80, 45, 50);
assert(Math.abs(picks - 72.0) < 0.0001, `Picks mismatch: got ${picks}`);
assert.strictEqual(GearMath.calculatePicks(80, 45, 0), 0, 'Zero bottom gear must return 0');
console.log('  ✓ calculatePicks computes weaving picks accurately');

// Test 6: Deviation calculation
const dev1 = GearMath.calculateDeviation(1000, 1020);
assert.strictEqual(dev1.absError, 20, 'Abs error should be 20');
assert.strictEqual(dev1.pctError, 2.0, 'Pct error should be 2.0%');

const devZero = GearMath.calculateDeviation(0, 1020);
assert.strictEqual(devZero.absError, 0);
assert.strictEqual(devZero.pctError, 0);
console.log('  ✓ calculateDeviation computes absolute and percentage deviation reliably');

console.log('\nResults: 6 passed, 0 failed');
console.log('All Phase 10 Gear Math Engine tests passed successfully!\n');
