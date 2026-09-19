const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateWarpWeightGramsPerMeter,
  calculateWeftWeightGramsPerMeter,
  calculateTfoProductionKgPerSpindleDay,
  calculateFabricCosting
} = require('../assets/textile-costing-engine.js');


test('CostingMath — Fabric Warp & Weft Calculation', async (t) => {
  await t.test('calculates accurate warp grams per meter for standard 80D Polyester 4800 Ends', () => {
    // 4800 ends * 80 denier * 1.05 crimp * 1.02 wastage / 9000 = 45.696 g/m
    const warpGrams = calculateWarpWeightGramsPerMeter(4800, 80, 5, 2);
    assert.ok(warpGrams > 45 && warpGrams < 46.5);
    assert.equal(warpGrams, 45.696);
  });

  await t.test('calculates accurate weft grams per meter for 60 PPI on 48" reed space with 150D', () => {
    const weftGrams = calculateWeftWeightGramsPerMeter(60, 48, 150, 3, 2);
    // Picks/m = 60 * 39.37 = 2362.2
    // Length/pick = 48 * 0.0254 * 1.03 = 1.255776 m
    // Total length = 2362.2 * 1.255776 * 1.02 = 3025.79 m
    // Grams = 3025.79 * 150 / 9000 = 50.43 g
    assert.ok(weftGrams > 50 && weftGrams < 51);
  });

  await t.test('handles zero and missing inputs safely without NaN or crash', () => {
    assert.equal(calculateWarpWeightGramsPerMeter(0, 80), 0);
    assert.equal(calculateWarpWeightGramsPerMeter(4800, 0), 0);
    assert.equal(calculateWeftWeightGramsPerMeter(0, 48, 150), 0);
  });
});

test('CostingMath — TFO Yarn Machine Production', async (t) => {
  await t.test('calculates accurate daily production for 9000 RPM, 350 TPM, 150D at 95% efficiency', () => {
    // Delivery m/min = 9000 * 2 / 350 = 51.428 m/min
    // Total meters/24h = 51.428 * 1440 * 0.95 = 70354.28 m
    // Total kg = 70354.28 * 150 / 9,000,000 = 1.1726 kg/spindle/day
    const kgPerSpindle = calculateTfoProductionKgPerSpindleDay(9000, 350, 150, 95);
    assert.ok(kgPerSpindle > 1.15 && kgPerSpindle < 1.20);
    assert.equal(kgPerSpindle, 1.1726);
  });
});

test('CostingMath — Total Fabric Cost and Margin Engine', async (t) => {
  await t.test('calculates complete fabric cost sheet and profit margin', () => {
    const result = calculateFabricCosting({
      warpGramsPerMeter: 50,      // 0.050 kg @ 180/kg = 9.00
      warpRatePerKg: 180,
      weftGramsPerMeter: 60,      // 0.060 kg @ 150/kg = 9.00
      weftRatePerKg: 150,
      weavingCostPerMeter: 8.50,
      processingCostPerMeter: 4.50,
      overheadCostPerMeter: 1.00,
      marginPercent: 15           // 15% on 32.00 = 4.80
    });

    assert.equal(result.rawMaterialCost, 18.00);
    assert.equal(result.manufacturingCost, 32.00);
    assert.equal(result.profit, 4.80);
    assert.equal(result.sellingPrice, 36.80);
    assert.equal(result.gsm, 110.00);
  });
});
