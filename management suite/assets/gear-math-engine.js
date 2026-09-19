/**
 * Vishwa Atelier Management Suite — Textile Gear Math Engine
 * Standalone, zero-dependency calculation library for yarn twist (TPM),
 * doubler gearing, weaving picks, and contraction/slip adjustments.
 *
 * UMD: Usable in browser (window.VishwaGearMath) and Node.js (require).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VishwaGearMath = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Calculate 4-gear train ratio: (B / A) * (D / C)
   * Where A and C are drivers, B and D are driven gears.
   */
  function calculateGearRatio(b, a, d, c) {
    const numA = Number(a);
    const numB = Number(b);
    const numC = Number(c);
    const numD = Number(d);
    if (!numA || !numC || numA <= 0 || numC <= 0) return 0;
    return (numB / numA) * (numD / numC);
  }

  /**
   * Calculate nominal TFO / Covering TPM using machine constant and 4-gear train
   * Equation: TPM = K * (B / A) * (D / C)
   */
  function calculateTfoTpm(kConstant, a, b, c, d) {
    const k = Number(kConstant);
    if (!k || k <= 0) return 0;
    const ratio = calculateGearRatio(b, a, d, c);
    return k * ratio;
  }

  /**
   * Calculate actual delivered TPM adjusted for spindle slip (%) and yarn contraction (%)
   * Equation: Actual TPM = (CalcTPM * (1 - Slip% / 100)) / (1 - Contraction% / 100)
   */
  function calculateActualTpm(calcTpm, slipPct = 0, contractionPct = 0) {
    const tpm = Number(calcTpm);
    if (!tpm || tpm <= 0) return 0;

    const slip = Number(slipPct) || 0;
    const contraction = Number(contractionPct) || 0;

    const denom = 1 - (contraction / 100);
    if (denom <= 0) return tpm; // prevent division by zero or negative denominator

    const numer = tpm * (1 - (slip / 100));
    return numer / denom;
  }

  /**
   * Calculate 2-gear ratio: Drum / Shaft
   */
  function calculateDoublerRatio(drum, shaft) {
    const d = Number(drum);
    const s = Number(shaft);
    if (!s || s <= 0) return 0;
    return d / s;
  }

  /**
   * Calculate Doubler Yarn TPM using machine constant and drum/shaft gears
   * Equation: TPM = K * (Drum / Shaft)
   */
  function calculateDoublerTpm(kConstant, drum, shaft) {
    const k = Number(kConstant);
    if (!k || k <= 0) return 0;
    const ratio = calculateDoublerRatio(drum, shaft);
    return k * ratio;
  }

  /**
   * Calculate Weaving Loom Picks per Inch / cm using machine constant and top/bottom gears
   * Equation: Picks = K * (Top / Bottom)
   */
  function calculatePicks(kConstant, top, bottom) {
    const k = Number(kConstant);
    const t = Number(top);
    const b = Number(bottom);
    if (!k || !b || b <= 0) return 0;
    return k * (t / b);
  }

  /**
   * Calculate absolute error and percentage deviation between target and calculated value
   */
  function calculateDeviation(target, calculated) {
    const tgt = Number(target);
    const calc = Number(calculated);
    if (!tgt || tgt <= 0) return { absError: 0, pctError: 0 };
    const absError = Math.abs(calc - tgt);
    const pctError = (absError / tgt) * 100;
    return { absError, pctError };
  }

  return {
    calculateGearRatio,
    calculateTfoTpm,
    calculateActualTpm,
    calculateDoublerRatio,
    calculateDoublerTpm,
    calculatePicks,
    calculateDeviation
  };
}));
