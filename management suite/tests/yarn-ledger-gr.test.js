const test = require('node:test');
const assert = require('node:assert');

test('Yarn Ledger — Goods Return (GR) Calculation & Deduction Engine', async (t) => {

  function computeBatchGrMetrics(batch, effectiveRate) {
    let totalGrossQty = 0;
    let totalGrQty = 0;
    let grBoxes = [];

    if (Array.isArray(batch.boxes) && batch.boxes.length > 0) {
      batch.boxes.forEach(b => {
        const bw = Number(b.grossWeight) || Number(b.weight) || 0;
        const gw = Number(b.returnedWeight) || Number(b.grWeight) || 0;
        totalGrossQty += bw;
        totalGrQty += gw;
        if (gw > 0) {
          grBoxes.push({
            boxNumber: b.boxNumber || b.id || '',
            cones: Number(b.cones) || 0,
            weight: bw,
            returnedWeight: gw,
            date: (b.returnedDate || b.grDate || '').split('T')[0],
            remarks: b.returnedRemarks || b.grRemarks || ''
          });
        }
      });
    }

    if (totalGrossQty === 0) {
      totalGrossQty = Number(batch.totalWeight) || Number(batch.receivedQty) || 0;
    }
    if (totalGrQty === 0) {
      totalGrQty = Number(batch.returnedWeight) || Number(batch.grWeight) || 0;
    }

    totalGrossQty = Number(totalGrossQty.toFixed(2));
    totalGrQty = Number(totalGrQty.toFixed(2));
    const netQty = Math.max(0, Number((totalGrossQty - totalGrQty).toFixed(2)));

    const grossAmount = Number((totalGrossQty * effectiveRate).toFixed(2));
    const grAmount = Number((totalGrQty * effectiveRate).toFixed(2));
    const subtotal = Number((netQty * effectiveRate).toFixed(2));
    const gstPercent = 5.0;
    const gstAmount = Number(((subtotal * gstPercent) / 100).toFixed(2));
    const grandTotal = Number((subtotal + gstAmount).toFixed(2));

    return {
      grossQty: totalGrossQty,
      grQty: totalGrQty,
      qty: netQty,
      grAmount,
      grossAmount,
      subtotal,
      gstPercent,
      gstAmount,
      grandTotal,
      grBoxes
    };
  }

  function computeRowFinancials(row, calculateInterest = true, defaultInterestRate = 18.0) {
    const grandTotal = Number(row.grandTotal) || 0;
    const paid = Number(row.paidAmount) || 0;
    const principalOutstanding = Math.max(0, Number((grandTotal - paid).toFixed(2)));
    const isFullyReturned = (Number(row.qty) === 0 && Number(row.grQty) > 0);

    let overdueDays = 0;
    let interestAmount = 0;
    let status = 'pending';

    if (isFullyReturned) {
      status = 'gr';
      overdueDays = 0;
      interestAmount = 0;
    } else if (principalOutstanding <= 0) {
      status = 'paid';
    } else {
      status = 'pending';
    }

    return {
      principalOutstanding,
      status,
      overdueDays,
      interestAmount,
      isFullyReturned
    };
  }

  await t.test('calculates accurate net billable quantity and GR deduction amount for partially returned batch', () => {
    const batch = {
      boxes: [
        { boxNumber: '101', cones: 24, grossWeight: 32.5, returnedWeight: 0 },
        { boxNumber: '102', cones: 24, grossWeight: 31.8, returnedWeight: 31.8, returnedRemarks: 'Damaged cone' },
        { boxNumber: '103', cones: 24, grossWeight: 32.0, returnedWeight: 0 }
      ]
    };
    const rate = 250; // ₹250/kg

    const res = computeBatchGrMetrics(batch, rate);
    assert.strictEqual(res.grossQty, 96.3);
    assert.strictEqual(res.grQty, 31.8);
    assert.strictEqual(res.qty, 64.5); // 96.3 - 31.8
    assert.strictEqual(res.grossAmount, 24075); // 96.3 * 250
    assert.strictEqual(res.grAmount, 7950); // 31.8 * 250
    assert.strictEqual(res.subtotal, 16125); // 64.5 * 250 = Gross (24075) - GR Deduction (7950)
    assert.strictEqual(res.gstAmount, 806.25); // 5% of 16125
    assert.strictEqual(res.grandTotal, 16931.25);
    assert.strictEqual(res.grBoxes.length, 1);
    assert.strictEqual(res.grBoxes[0].boxNumber, '102');
  });

  await t.test('handles batch with 100% returned quantity (Full GR) without negative values or false overdue', () => {
    const batch = {
      boxes: [
        { boxNumber: '201', cones: 20, grossWeight: 50.0, returnedWeight: 50.0 }
      ]
    };
    const rate = 300;

    const res = computeBatchGrMetrics(batch, rate);
    assert.strictEqual(res.grossQty, 50.0);
    assert.strictEqual(res.grQty, 50.0);
    assert.strictEqual(res.qty, 0);
    assert.strictEqual(res.grossAmount, 15000);
    assert.strictEqual(res.grAmount, 15000);
    assert.strictEqual(res.subtotal, 0);
    assert.strictEqual(res.grandTotal, 0);

    const financials = computeRowFinancials({ ...res, paidAmount: 0 });
    assert.strictEqual(financials.status, 'gr');
    assert.strictEqual(financials.principalOutstanding, 0);
    assert.strictEqual(financials.interestAmount, 0);
  });

  await t.test('handles batch with zero returns normally', () => {
    const batch = {
      boxes: [
        { boxNumber: '301', cones: 20, grossWeight: 40.0, returnedWeight: 0 },
        { boxNumber: '302', cones: 20, grossWeight: 40.0, returnedWeight: 0 }
      ]
    };
    const rate = 200;

    const res = computeBatchGrMetrics(batch, rate);
    assert.strictEqual(res.grossQty, 80.0);
    assert.strictEqual(res.grQty, 0);
    assert.strictEqual(res.qty, 80.0);
    assert.strictEqual(res.subtotal, 16000);
    assert.strictEqual(res.grBoxes.length, 0);
  });
});
