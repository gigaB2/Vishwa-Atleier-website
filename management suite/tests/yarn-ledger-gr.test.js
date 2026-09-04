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

  await t.test('bidirectional sync updates yarn-rm-orders and stock data when GR is issued in ledger', () => {
    // Mock RM Orders dataset
    const orders = [
      {
        id: 'ORD-501',
        orderNumber: '501',
        supplier: 'Vardhman Mills',
        batches: [
          {
            id: 'BATCH-1',
            challanNumber: 'CH-8899',
            lotNumber: 'LOT-99',
            totalWeight: 100.0,
            returnedWeight: 0,
            boxes: [
              { boxNumber: 'B1', weight: 50.0, grossWeight: 50.0, returnedWeight: 0, status: 'available' },
              { boxNumber: 'B2', weight: 50.0, grossWeight: 50.0, returnedWeight: 0, status: 'issued', issueDate: '2026-09-01', issuedTo: 'Covering Unit 1' }
            ]
          }
        ]
      }
    ];

    // Mock Stock dataset
    const stock = [
      {
        id: 'LOT-99__CH-8899',
        batchId: 'BATCH-1',
        lotNumber: 'LOT-99',
        challanNo: 'CH-8899',
        supplier: 'Vardhman Mills',
        boxes: [
          { id: 'B1', boxNumber: 'B1', weight: 50.0, grossWeight: 50.0, remainingWeight: 50.0, grWeight: 0, status: 'available' },
          { id: 'B2', boxNumber: 'B2', weight: 50.0, grossWeight: 50.0, remainingWeight: 50.0, grWeight: 0, status: 'issued', issueDate: '2026-09-01', issuedTo: 'Covering Unit 1' }
        ]
      }
    ];

    // Ledger row where GR is issued on B2 (issued cone/box)
    const ledgerRow = {
      id: 'PUR-order_ORD-501_batch_BATCH-1_CH-8899',
      orderId: 'ORD-501',
      batchId: 'BATCH-1',
      challanNo: 'CH-8899',
      lotNumber: 'LOT-99',
      partyName: 'Vardhman Mills',
      rate: 300,
      grossQty: 100.0,
      grQty: 50.0,
      qty: 50.0
    };

    // Execute sync logic for box allocations: B1 untouched (0 GR), B2 returned (50 GR)
    const boxAllocations = [
      { boxNumber: 'B1', returnedWeight: 0, remarks: '' },
      { boxNumber: 'B2', returnedWeight: 50.0, remarks: 'Returned defective issued cones' }
    ];

    // 1. Update orders
    const targetBatch = orders[0].batches[0];
    targetBatch.returnedWeight = 50.0;
    boxAllocations.forEach(alloc => {
      const b = targetBatch.boxes.find(x => x.boxNumber === alloc.boxNumber);
      if (b) {
        b.returnedWeight = alloc.returnedWeight;
        if (b.returnedWeight >= b.grossWeight) {
          b.status = 'gr';
          b.issueDate = null;
          b.issuedTo = null;
        }
      }
    });

    // 2. Update stock
    const targetStockLot = stock[0];
    boxAllocations.forEach(alloc => {
      const b = targetStockLot.boxes.find(x => x.boxNumber === alloc.boxNumber);
      if (b) {
        b.grWeight = alloc.returnedWeight;
        b.remainingWeight = Math.max(0, b.grossWeight - alloc.returnedWeight);
        if (b.grWeight >= b.grossWeight) {
          b.status = 'gr';
          b.weight = b.grossWeight;
          b.issueDate = null;
          b.issuedTo = null;
        }
      }
    });

    // Verify Orders
    assert.strictEqual(targetBatch.returnedWeight, 50.0);
    assert.strictEqual(targetBatch.boxes[0].status, 'available');
    assert.strictEqual(targetBatch.boxes[0].returnedWeight, 0);
    assert.strictEqual(targetBatch.boxes[1].status, 'gr');
    assert.strictEqual(targetBatch.boxes[1].returnedWeight, 50.0);
    assert.strictEqual(targetBatch.boxes[1].issuedTo, null); // Issued cones returned via GR are no longer locked in issued state!

    // Verify Stockbook
    assert.strictEqual(targetStockLot.boxes[0].status, 'available');
    assert.strictEqual(targetStockLot.boxes[1].status, 'gr');
    assert.strictEqual(targetStockLot.boxes[1].grWeight, 50.0);
    assert.strictEqual(targetStockLot.boxes[1].remainingWeight, 0);
    assert.strictEqual(targetStockLot.boxes[1].issuedTo, null);
  });

  await t.test('stockbook GR filter correctly matches both full GR and partial GR boxes', () => {
    const boxes = [
      { id: 'B1', status: 'available', grWeight: 0 },
      { id: 'B2', status: 'issued', grWeight: 0 },
      { id: 'B3', status: 'gr', grWeight: 50.0 }, // 100% full GR
      { id: 'B4', status: 'available', grWeight: 10.0, remainingWeight: 40.0 }, // partial GR available
      { id: 'B5', status: 'issued', grWeight: 15.0, remainingWeight: 35.0 } // partial GR issued
    ];

    const statusFilter = 'gr';
    const filteredBoxes = boxes.filter(b => {
      if (statusFilter === 'gr' && b.status !== 'gr' && !(b.grWeight > 0)) return false;
      return true;
    });

    assert.strictEqual(filteredBoxes.length, 3);
    assert.deepStrictEqual(filteredBoxes.map(b => b.id), ['B3', 'B4', 'B5']);
  });

  await t.test('partial GR on issued cones keeps remaining weight as issued and does not bring it to available', () => {
    // 1. Initial State: Box B2 was issued to covering unit
    const stockLot = {
      id: 'LOT-99__CH-8899',
      batchId: 'BATCH-1',
      lotNumber: 'LOT-99',
      challanNo: 'CH-8899',
      boxes: [
        { id: 'B1', boxNumber: 'B1', weight: 50.0, grossWeight: 50.0, remainingWeight: 50.0, grWeight: 0, status: 'available' },
        { id: 'B2', boxNumber: 'B2', weight: 50.0, grossWeight: 50.0, remainingWeight: 50.0, grWeight: 0, status: 'issued', issueDate: '2026-09-01', issuedTo: 'Covering Unit 1' }
      ]
    };

    // 2. Issue a PARTIAL GR of 15 kg on B2 (remaining: 35 kg)
    const boxAllocations = [
      { boxNumber: 'B2', returnedWeight: 15.0, remarks: 'Defective cones returned' }
    ];

    boxAllocations.forEach(alloc => {
      const b = stockLot.boxes.find(x => x.boxNumber === alloc.boxNumber);
      if (b) {
        b.grWeight = alloc.returnedWeight;
        b.remainingWeight = Math.max(0, b.grossWeight - alloc.returnedWeight);
        if (b.grWeight >= b.grossWeight && b.grossWeight > 0) {
          b.status = 'gr';
          b.weight = b.grossWeight;
          b.issueDate = null;
          b.issuedTo = null;
        } else {
          b.weight = b.remainingWeight;
          // Because B2 was already issued, remaining 35 kg remains ISSUED!
          if (b.status === 'issued' || b.issuedTo || b.issueDate) {
            b.status = 'issued';
          }
        }
      }
    });

    const b2 = stockLot.boxes[1];
    assert.strictEqual(b2.status, 'issued', 'Partial GR on issued box must keep status as issued');
    assert.strictEqual(b2.grWeight, 15.0);
    assert.strictEqual(b2.remainingWeight, 35.0);
    assert.strictEqual(b2.weight, 35.0);
    assert.strictEqual(b2.issuedTo, 'Covering Unit 1', 'issuedTo recipient must be preserved');
    assert.strictEqual(b2.issueDate, '2026-09-01', 'issueDate must be preserved');

    // 3. Compute stock aggregations
    let availWeight = 0;
    let issuedWeight = 0;
    let grWeight = 0;

    stockLot.boxes.forEach(b => {
      const rem = b.remainingWeight !== undefined ? b.remainingWeight : b.weight;
      const gr = b.grWeight || 0;
      if (b.status === 'available') {
        availWeight += rem;
        if (gr > 0) grWeight += gr;
      } else if (b.status === 'issued') {
        issuedWeight += rem;
        if (gr > 0) grWeight += gr;
      } else if (b.status === 'gr') {
        grWeight += (gr || b.grossWeight || b.weight || 0);
      }
    });

    assert.strictEqual(availWeight, 50.0, 'Available weight should only be B1 (50 kg), NOT including remaining issued B2');
    assert.strictEqual(issuedWeight, 35.0, 'Issued weight should be the remaining 35 kg of B2');
    assert.strictEqual(grWeight, 15.0, 'GR weight should be 15 kg');
  });
});

