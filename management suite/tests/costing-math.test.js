const test = require('node:test');
const assert = require('node:assert/strict');

// Standard Textile Formulas implemented in Vishwa Atelier Weaving & Yarn Costing Engines

/**
 * Calculates warp yarn weight in grams per linear meter of fabric (Denier system)
 * @param {number} totalEnds Total number of warp threads across fabric width
 * @param {number} denier Yarn Denier (g / 9000m)
 * @param {number} crimpPercent Warp crimp / take-up percentage (e.g. 5 for 5%)
 * @param {number} wastagePercent Sizing/warping wastage percentage (e.g. 2 for 2%)
 */
function calculateWarpWeightGramsPerMeter(totalEnds, denier, crimpPercent = 5, wastagePercent = 2) {
  if (!totalEnds || !denier) return 0;
  const crimpMultiplier = 1 + (crimpPercent / 100);
  const wastageMultiplier = 1 + (wastagePercent / 100);
  // (Ends * Denier * CrimpFactor * WastageFactor) / 9000
  const grams = (totalEnds * denier * crimpMultiplier * wastageMultiplier) / 9000;
  return Number(grams.toFixed(3));
}

/**
 * Calculates weft yarn weight in grams per linear meter of fabric (Denier system)
 * @param {number} picksPerInch Picks per inch (PPI) in loom
 * @param {number} reedSpaceInches Width of warp in reed (inches)
 * @param {number} denier Weft Yarn Denier
 * @param {number} crimpPercent Weft crimp / contraction percentage (e.g. 3 for 3%)
 * @param {number} wastagePercent Loom / Pirn / Bobbin wastage percentage (e.g. 2 for 2%)
 */
function calculateWeftWeightGramsPerMeter(picksPerInch, reedSpaceInches, denier, crimpPercent = 3, wastagePercent = 2) {
  if (!picksPerInch || !reedSpaceInches || !denier) return 0;
  // 1 meter = 39.37 inches
  const picksPerMeter = picksPerInch * 39.37;
  const weftLengthPerPickMeters = (reedSpaceInches * 0.0254) * (1 + crimpPercent / 100);
  const totalWeftLengthMeters = picksPerMeter * weftLengthPerPickMeters * (1 + wastagePercent / 100);
  const grams = (totalWeftLengthMeters * denier) / 9000;
  return Number(grams.toFixed(3));
}

/**
 * Calculates TFO / Doubler Yarn Production in KG per spindle per 24 hours
 * @param {number} spindleRpm Spindle Speed (RPM)
 * @param {number} tpm Turns Per Meter (TPM)
 * @param {number} denier Resultant Yarn Denier
 * @param {number} efficiencyPercent Machine efficiency % (e.g. 95)
 */
function calculateTfoProductionKgPerSpindleDay(spindleRpm, tpm, denier, efficiencyPercent = 95) {
  if (!spindleRpm || !tpm || !denier) return 0;
  // Delivery speed (meters/min) = (spindleRpm * 2) / tpm for Two-For-One (TFO produces 2 twists per turn)
  const deliveryMetersPerMin = (spindleRpm * 2) / tpm;
  const totalMeters24h = deliveryMetersPerMin * 60 * 24 * (efficiencyPercent / 100);
  const totalKg = (totalMeters24h * denier) / (9000 * 1000);
  return Number(totalKg.toFixed(4));
}

/**
 * Calculates Total Fabric Cost and Selling Price per meter
 */
function calculateFabricCosting({
  warpGramsPerMeter,
  warpRatePerKg,
  weftGramsPerMeter,
  weftRatePerKg,
  weavingCostPerMeter,
  processingCostPerMeter = 0,
  overheadCostPerMeter = 0,
  marginPercent = 10
}) {
  const warpCost = (warpGramsPerMeter / 1000) * warpRatePerKg;
  const weftCost = (weftGramsPerMeter / 1000) * weftRatePerKg;
  const rawMaterialCost = warpCost + weftCost;
  const manufacturingCost = rawMaterialCost + weavingCostPerMeter + processingCostPerMeter + overheadCostPerMeter;
  const profit = (manufacturingCost * marginPercent) / 100;
  const sellingPrice = manufacturingCost + profit;

  return {
    rawMaterialCost: Number(rawMaterialCost.toFixed(2)),
    manufacturingCost: Number(manufacturingCost.toFixed(2)),
    profit: Number(profit.toFixed(2)),
    sellingPrice: Number(sellingPrice.toFixed(2)),
    gsm: Number((warpGramsPerMeter + weftGramsPerMeter).toFixed(2))
  };
}

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
