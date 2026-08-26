const test = require('node:test');
const assert = require('node:assert/strict');
const FYEngine = require('../assets/fy-engine.js');

test('FYEngine — getFinancialYearForDate', async (t) => {
  await t.test('correctly identifies Indian FY for dates in April (start of FY)', () => {
    assert.equal(FYEngine.getFinancialYearForDate('2026-04-01'), '2026-27');
    assert.equal(FYEngine.getFinancialYearForDate('2026-04-15'), '2026-27');
  });

  await t.test('correctly identifies Indian FY for dates in March (end of FY)', () => {
    assert.equal(FYEngine.getFinancialYearForDate('2026-03-31'), '2025-26');
    assert.equal(FYEngine.getFinancialYearForDate('2026-03-01'), '2025-26');
  });

  await t.test('supports long format YYYY-YYYY', () => {
    assert.equal(FYEngine.getFinancialYearForDate('2026-06-15', false), '2026-2027');
    assert.equal(FYEngine.getFinancialYearForDate('2026-01-10', false), '2025-2026');
  });

  await t.test('handles Date objects and edge dates', () => {
    const d1 = new Date(2025, 3, 1); // 2025-04-01
    const d2 = new Date(2025, 2, 31); // 2025-03-31
    assert.equal(FYEngine.getFinancialYearForDate(d1), '2025-26');
    assert.equal(FYEngine.getFinancialYearForDate(d2), '2024-25');
  });

  await t.test('returns null for invalid inputs', () => {
    assert.equal(FYEngine.getFinancialYearForDate(null), null);
    assert.equal(FYEngine.getFinancialYearForDate(''), null);
    assert.equal(FYEngine.getFinancialYearForDate('invalid-date'), null);
  });
});

test('FYEngine — getFYDateRange', async (t) => {
  await t.test('correctly expands short format 2026-27', () => {
    const range = FYEngine.getFYDateRange('2026-27');
    assert.deepEqual(range, {
      start: '2026-04-01',
      end: '2027-03-31'
    });
  });

  await t.test('correctly expands long format 2025-2026', () => {
    const range = FYEngine.getFYDateRange('2025-2026');
    assert.deepEqual(range, {
      start: '2025-04-01',
      end: '2026-03-31'
    });
  });

  await t.test('handles All or empty string gracefully', () => {
    assert.deepEqual(FYEngine.getFYDateRange('All'), { start: null, end: null });
    assert.deepEqual(FYEngine.getFYDateRange(''), { start: null, end: null });
    assert.deepEqual(FYEngine.getFYDateRange(null), { start: null, end: null });
  });
});

test('FYEngine — calculateStockCarryForward', async (t) => {
  await t.test('correctly computes running balance across FY boundaries', () => {
    // Prior FY receipts (before 2025-04-01)
    const receipts = [
      { date: '2024-05-10', item: 'Polyester 150D', qty: 1000 },
      { date: '2025-01-15', item: 'Polyester 150D', qty: 500 },
      { date: '2025-04-10', item: 'Polyester 150D', qty: 800 } // Current FY (should NOT be in prior opening)
    ];

    // Prior FY issues (before 2025-04-01)
    const issues = [
      { date: '2024-08-20', item: 'Polyester 150D', qty: 400 },
      { date: '2025-02-15', item: 'Polyester 150D', qty: 300 },
      { date: '2025-05-01', item: 'Polyester 150D', qty: 200 } // Current FY (should NOT be in prior opening)
    ];

    const openingStock = FYEngine.calculateStockCarryForward({
      receipts: receipts,
      issues: issues,
      startDate: '2025-04-01',
      initialStock: 100,
      itemFilter: (item) => item.item === 'Polyester 150D'
    });

    // Opening = Initial (100) + Prior Receipts (1000 + 500) - Prior Issues (400 + 300) = 100 + 1500 - 700 = 900
    assert.equal(openingStock, 900);
  });

  await t.test('handles zero initial stock and empty transaction lists', () => {
    const openingStock = FYEngine.calculateStockCarryForward({
      receipts: [],
      issues: [],
      startDate: '2026-04-01'
    });
    assert.equal(openingStock, 0);
  });
});
