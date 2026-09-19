/**
 * Vishwa Atelier Management Suite — Textile Costing Engine
 * Standalone, zero-dependency calculation library for fabric warp/weft
 * yarn consumption, TFO spindle yield, and fabric costing sheets.
 *
 * UMD: Usable in browser (window.VishwaCostingEngine) and Node.js (require).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VishwaCostingEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Calculates warp yarn weight in grams per linear meter of fabric (Denier system)
   * Formula: (Ends * Denier * (1 + Crimp%) * (1 + Wastage%)) / 9000
   *
   * @param {number} totalEnds Total number of warp threads across fabric width
   * @param {number} denier Yarn Denier (g / 9000m)
   * @param {number} [crimpPercent=5] Warp crimp / take-up percentage (e.g. 5 for 5%)
   * @param {number} [wastagePercent=2] Sizing/warping wastage percentage (e.g. 2 for 2%)
   * @returns {number} Grams per linear meter
   */
  function calculateWarpWeightGramsPerMeter(totalEnds, denier, crimpPercent = 5, wastagePercent = 2) {
    const ends = Number(totalEnds);
    const d = Number(denier);
    if (!ends || !d || ends <= 0 || d <= 0) return 0;

    const crimpMultiplier = 1 + (Number(crimpPercent) || 0) / 100;
    const wastageMultiplier = 1 + (Number(wastagePercent) || 0) / 100;

    const grams = (ends * d * crimpMultiplier * wastageMultiplier) / 9000;
    return Number(grams.toFixed(3));
  }

  /**
   * Calculates weft yarn weight in grams per linear meter of fabric (Denier system)
   * Formula: Total Weft Length (m) * Denier / 9000
   * Where Total Weft Length = (PPI * 39.37) * (ReedSpaceInches * 0.0254 * (1 + Crimp%)) * (1 + Wastage%)
   *
   * @param {number} picksPerInch Picks per inch (PPI) in loom
   * @param {number} reedSpaceInches Width of warp in reed (inches)
   * @param {number} denier Weft Yarn Denier
   * @param {number} [crimpPercent=3] Weft crimp / contraction percentage (e.g. 3 for 3%)
   * @param {number} [wastagePercent=2] Loom / Pirn / Bobbin wastage percentage (e.g. 2 for 2%)
   * @returns {number} Grams per linear meter
   */
  function calculateWeftWeightGramsPerMeter(picksPerInch, reedSpaceInches, denier, crimpPercent = 3, wastagePercent = 2) {
    const ppi = Number(picksPerInch);
    const reed = Number(reedSpaceInches);
    const d = Number(denier);
    if (!ppi || !reed || !d || ppi <= 0 || reed <= 0 || d <= 0) return 0;

    const crimp = Number(crimpPercent) || 0;
    const wastage = Number(wastagePercent) || 0;

    // 1 meter = 39.37 inches
    const picksPerMeter = ppi * 39.37;
    const weftLengthPerPickMeters = (reed * 0.0254) * (1 + crimp / 100);
    const totalWeftLengthMeters = picksPerMeter * weftLengthPerPickMeters * (1 + wastage / 100);
    const grams = (totalWeftLengthMeters * d) / 9000;
    return Number(grams.toFixed(3));
  }

  /**
   * Calculates TFO / Doubler Yarn Production in KG per spindle per 24 hours
   * Formula: Delivery speed (m/min) * 1440 min * Efficiency * Denier / (9000 * 1000)
   * Where Delivery speed (m/min) = (SpindleRPM * 2) / TPM
   *
   * @param {number} spindleRpm Spindle Speed (RPM)
   * @param {number} tpm Turns Per Meter (TPM)
   * @param {number} denier Resultant Yarn Denier
   * @param {number} [efficiencyPercent=95] Machine efficiency % (e.g. 95)
   * @returns {number} KG per spindle per day (24 hours)
   */
  function calculateTfoProductionKgPerSpindleDay(spindleRpm, tpm, denier, efficiencyPercent = 95) {
    const rpm = Number(spindleRpm);
    const t = Number(tpm);
    const d = Number(denier);
    if (!rpm || !t || !d || rpm <= 0 || t <= 0 || d <= 0) return 0;

    const eff = Number(efficiencyPercent) || 0;
    const deliveryMetersPerMin = (rpm * 2) / t;
    const totalMeters24h = deliveryMetersPerMin * 60 * 24 * (eff / 100);
    const totalKg = (totalMeters24h * d) / (9000 * 1000);
    return Number(totalKg.toFixed(4));
  }

  /**
   * Calculates Total Fabric Cost and Selling Price per meter
   *
   * @param {Object} params
   * @param {number} params.warpGramsPerMeter Warp weight in grams/meter
   * @param {number} params.warpRatePerKg Yarn price per KG for warp
   * @param {number} params.weftGramsPerMeter Weft weight in grams/meter
   * @param {number} params.weftRatePerKg Yarn price per KG for weft
   * @param {number} params.weavingCostPerMeter Job work / weaving charges per meter
   * @param {number} [params.processingCostPerMeter=0] Dyeing, printing, or finishing cost per meter
   * @param {number} [params.overheadCostPerMeter=0] Administrative / factory overhead per meter
   * @param {number} [params.marginPercent=10] Target profit margin percentage
   * @returns {Object} Costing breakdown: rawMaterialCost, manufacturingCost, profit, sellingPrice, gsm
   */
  function calculateFabricCosting({
    warpGramsPerMeter = 0,
    warpRatePerKg = 0,
    weftGramsPerMeter = 0,
    weftRatePerKg = 0,
    weavingCostPerMeter = 0,
    processingCostPerMeter = 0,
    overheadCostPerMeter = 0,
    marginPercent = 10
  } = {}) {
    const warpCost = ((Number(warpGramsPerMeter) || 0) / 1000) * (Number(warpRatePerKg) || 0);
    const weftCost = ((Number(weftGramsPerMeter) || 0) / 1000) * (Number(weftRatePerKg) || 0);
    const rawMaterialCost = warpCost + weftCost;
    const manufacturingCost = rawMaterialCost +
      (Number(weavingCostPerMeter) || 0) +
      (Number(processingCostPerMeter) || 0) +
      (Number(overheadCostPerMeter) || 0);

    const margin = Number(marginPercent) || 0;
    const profit = (manufacturingCost * margin) / 100;
    const sellingPrice = manufacturingCost + profit;
    const gsm = (Number(warpGramsPerMeter) || 0) + (Number(weftGramsPerMeter) || 0);

    return {
      rawMaterialCost: Number(rawMaterialCost.toFixed(2)),
      manufacturingCost: Number(manufacturingCost.toFixed(2)),
      profit: Number(profit.toFixed(2)),
      sellingPrice: Number(sellingPrice.toFixed(2)),
      gsm: Number(gsm.toFixed(2))
    };
  }

  return {
    calculateWarpWeightGramsPerMeter,
    calculateWeftWeightGramsPerMeter,
    calculateTfoProductionKgPerSpindleDay,
    calculateFabricCosting
  };
}));
