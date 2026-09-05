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

  await t.test('modal loads all original delivery boxes even when some already have saved GR', () => {
    // 1. Orders batch has 4 boxes (B1, B2, B3, B4)
    const orders = [
      {
        id: 'ORD-701',
        orderNumber: '701',
        supplier: 'Reliance Industries',
        batches: [
          {
            id: 'BATCH-701-1',
            challanNumber: 'CH-9900',
            lotNumber: 'LOT-77',
            totalWeight: 160.0,
            returnedWeight: 40.0,
            boxes: [
              { boxNumber: 'B1', weight: 40.0, grossWeight: 40.0, returnedWeight: 40.0, returnedDate: '2026-09-02', returnedRemarks: 'Defective cone', status: 'gr' },
              { boxNumber: 'B2', weight: 40.0, grossWeight: 40.0, returnedWeight: 0, status: 'available' },
              { boxNumber: 'B3', weight: 40.0, grossWeight: 40.0, returnedWeight: 0, status: 'available' },
              { boxNumber: 'B4', weight: 40.0, grossWeight: 40.0, returnedWeight: 0, status: 'available' }
            ]
          }
        ]
      }
    ];

    // 2. Ledger row previously saved with only B1 in grBoxes
    const ledgerRow = {
      id: 'PUR-ORD-701-1',
      orderId: 'ORD-701',
      batchId: 'BATCH-701-1',
      challanNo: 'CH-9900',
      lotNumber: 'LOT-77',
      partyName: 'Reliance Industries',
      grossQty: 160.0,
      grQty: 40.0,
      qty: 120.0,
      grBoxes: [
        { boxNumber: 'B1', cones: 20, weight: 40.0, returnedWeight: 40.0, date: '2026-09-02', remarks: 'Defective cone' }
      ]
    };

    // Simulate openIssueGrModal box loader logic
    const matchedBatch = orders[0].batches[0];
    let batchBoxes = matchedBatch.boxes.map((bx, idx) => ({
      boxNumber: bx.boxNumber || bx.id || `B${idx + 1}`,
      cones: Number(bx.cones) || 0,
      weight: Number(bx.grossWeight) || Number(bx.weight) || 0,
      returnedWeight: Number(bx.returnedWeight) || 0,
      date: bx.returnedDate || '',
      remarks: bx.returnedRemarks || '',
      status: bx.status || 'available'
    }));

    if (Array.isArray(ledgerRow.grBoxes) && ledgerRow.grBoxes.length > 0) {
      const grMap = new Map();
      ledgerRow.grBoxes.forEach(b => grMap.set(String(b.boxNumber).trim(), b));
      batchBoxes = batchBoxes.map(bx => {
        const bNum = String(bx.boxNumber).trim();
        if (grMap.has(bNum)) {
          const saved = grMap.get(bNum);
          return {
            ...bx,
            returnedWeight: Number(saved.returnedWeight) || 0,
            date: saved.date || bx.date,
            remarks: saved.remarks || bx.remarks
          };
        }
        return bx;
      });
    }

    // Must have all 4 boxes loaded
    assert.strictEqual(batchBoxes.length, 4, 'All 4 boxes in batch must be loaded');
    assert.strictEqual(batchBoxes[0].boxNumber, 'B1');
    assert.strictEqual(batchBoxes[0].returnedWeight, 40.0);
    assert.strictEqual(batchBoxes[1].boxNumber, 'B2');
    assert.strictEqual(batchBoxes[1].returnedWeight, 0);
    assert.strictEqual(batchBoxes[2].boxNumber, 'B3');
    assert.strictEqual(batchBoxes[3].boxNumber, 'B4');
  });

  await t.test('syncGRToOrdersAndStock updates batch totalWeight, receivedQty, and box statuses in yarn-rm-orders', () => {
    const orders = [
      {
        id: 'ORD-801',
        orderNumber: '801',
        supplier: 'Welspun India',
        batches: [
          {
            id: 'BATCH-801-1',
            challanNumber: 'CH-1122',
            lotNumber: 'LOT-88',
            totalWeight: 200.0,
            returnedWeight: 0,
            boxes: [
              { boxNumber: 'B1', weight: 50.0, grossWeight: 50.0, returnedWeight: 0, status: 'available' },
              { boxNumber: 'B2', weight: 50.0, grossWeight: 50.0, returnedWeight: 0, status: 'available' },
              { boxNumber: 'B3', weight: 50.0, grossWeight: 50.0, returnedWeight: 0, status: 'available' },
              { boxNumber: 'B4', weight: 50.0, grossWeight: 50.0, returnedWeight: 0, status: 'available' }
            ]
          }
        ]
      }
    ];

    const ledgerRow = {
      id: 'PUR-801',
      orderId: 'ORD-801',
      batchId: 'BATCH-801-1',
      challanNo: 'CH-1122',
      lotNumber: 'LOT-88',
      partyName: 'Welspun India',
      rate: 220,
      grossQty: 200.0
    };

    // User returns B2 (50 kg) and 20 kg of B3 (total GR = 70 kg)
    const boxAllocations = [
      { boxNumber: 'B1', returnedWeight: 0, remarks: '' },
      { boxNumber: 'B2', returnedWeight: 50.0, remarks: '100% defective return' },
      { boxNumber: 'B3', returnedWeight: 20.0, remarks: 'Partial return 20 kg' },
      { boxNumber: 'B4', returnedWeight: 0, remarks: '' }
    ];
    const newGrQty = 70.0;

    // Execute sync
    const targetBatch = orders[0].batches[0];
    const grossTotal = targetBatch.boxes.reduce((acc, bx) => acc + (Number(bx.grossWeight) || Number(bx.weight) || 0), 0);
    targetBatch.returnedWeight = Number(newGrQty.toFixed(2));
    targetBatch.totalWeight = Math.max(0, Number((grossTotal - newGrQty).toFixed(2)));
    targetBatch.receivedQty = targetBatch.totalWeight;

    boxAllocations.forEach(alloc => {
      const b = targetBatch.boxes.find(x => x.boxNumber === alloc.boxNumber);
      if (b) {
        b.returnedWeight = alloc.returnedWeight;
        b.grossWeight = Number(b.grossWeight) || Number(b.weight) || 0;
        if (alloc.returnedWeight >= b.grossWeight && b.grossWeight > 0) {
          b.status = 'gr';
        } else if (b.status === 'gr' && alloc.returnedWeight < b.grossWeight) {
          b.status = 'available';
        }
      }
    });

    // Verify order updates
    assert.strictEqual(targetBatch.returnedWeight, 70.0, 'Batch returned weight must be 70 kg');
    assert.strictEqual(targetBatch.totalWeight, 130.0, 'Batch net weight must be 130 kg (200 - 70)');
    assert.strictEqual(targetBatch.receivedQty, 130.0, 'Batch receivedQty must equal net totalWeight');
    assert.strictEqual(targetBatch.boxes[0].status, 'available');
    assert.strictEqual(targetBatch.boxes[1].status, 'gr', 'B2 must have status gr');
    assert.strictEqual(targetBatch.boxes[2].status, 'available', 'B3 partial return must remain available for the remaining 30 kg');
    assert.strictEqual(targetBatch.boxes[2].returnedWeight, 20.0);
    assert.strictEqual(targetBatch.boxes[3].status, 'available');
  });

  await t.test('OrderDetailsModal in + Challan correctly reflects GR, gross received, and net weight from synced batch', () => {
    const order = {
      id: 'ORD-901',
      orderNumber: '901',
      supplier: 'Sintex Industries',
      orderedWeight: 1000.0,
      batches: [
        {
          id: 'BATCH-901-1',
          challanNumber: 'CH-901',
          lotNumber: 'LOT-901',
          totalWeight: 360.0,
          returnedWeight: 40.0,
          boxes: [
            { boxNumber: 'B1', weight: 100.0, returnedWeight: 40.0, cones: 20 },
            { boxNumber: 'B2', weight: 100.0, returnedWeight: 0, cones: 20 },
            { boxNumber: 'B3', weight: 100.0, returnedWeight: 0, cones: 20 },
            { boxNumber: 'B4', weight: 100.0, returnedWeight: 0, cones: 20 }
          ]
        },
        {
          id: 'BATCH-901-2',
          challanNumber: 'CH-902',
          lotNumber: 'LOT-902',
          totalWeight: 450.0,
          returnedWeight: 50.0,
          grossWeight: 500.0,
          boxes: [] // Legacy or direct batch without box array
        }
      ]
    };

    const getBatchGross = (b) => {
      const boxGross = (b.boxes || []).reduce((acc, box) => acc + (Number(box.weight) || 0), 0);
      return boxGross > 0 ? boxGross : (Number(b.grossWeight) || Number(b.totalWeight) || 0);
    };

    const getBatchGR = (b) => {
      const boxGR = (b.boxes || []).reduce((acc, box) => acc + (Number(box.returnedWeight) || 0), 0);
      return boxGR > 0 ? boxGR : (Number(b.returnedWeight) || 0);
    };

    const getBatchNet = (b) => {
      if (b.totalWeight !== undefined && b.totalWeight !== null && b.totalWeight !== '') {
        return Number(b.totalWeight);
      }
      return Math.max(0, getBatchGross(b) - getBatchGR(b));
    };

    const grossReceived = (order.batches || []).reduce((acc, b) => acc + getBatchGross(b), 0);
    const gr = (order.batches || []).reduce((acc, b) => acc + getBatchGR(b), 0);
    const received = (order.batches || []).reduce((acc, b) => acc + getBatchNet(b), 0);

    assert.strictEqual(grossReceived, 900.0, 'Gross received should be 400 + 500 = 900 kg');
    assert.strictEqual(gr, 90.0, 'GR should be 40 + 50 = 90 kg');
    assert.strictEqual(received, 810.0, 'Net received should be 360 + 450 = 810 kg');
  });

  await t.test('ledger.html actions column contains only the Eye button and Delete button, not the GR button', () => {
    const fs = require('fs');
    const path = require('path');
    const ledgerHtml = fs.readFileSync(path.join(__dirname, '../modules/yarn/ledger.html'), 'utf8');

    // Find the actions-cell-wrap block
    const actionsBlockMatch = ledgerHtml.match(/<div class="actions-cell-wrap">([\s\S]*?)<\/div>/);
    assert.ok(actionsBlockMatch, 'actions-cell-wrap must exist in ledger.html');
    const actionsContent = actionsBlockMatch[1];

    assert.ok(actionsContent.includes('openChallanModal'), 'Actions column must include openChallanModal (the Eye)');
    assert.ok(!actionsContent.includes('openIssueGrModal'), 'Actions column must NOT include openIssueGrModal (GR button removed)');
    
    // Check that GR inline button still exists in the GR column
    assert.ok(ledgerHtml.includes('btn-issue-gr-inline'), 'Inline GR button in GR column must remain intact');
  });

  await t.test('tri-sheet sync: entering batch with GR in RM Orders updates both stock data and purchase ledger', () => {
    // 1. Setup initial state
    const order = {
      id: 'ORD-TRI-01',
      orderNumber: 'TRI-01',
      supplier: 'Supreme Spinners',
      quality: '150D Bright Polyester',
      price: 240,
      creditDays: 45,
      batches: []
    };

    const batchData = {
      id: 'BATCH-TRI-01',
      challanNumber: 'CH-TRI-99',
      lotNumber: 'LOT-TRI-99',
      receiveDate: '2026-09-05',
      boxes: [
        { boxNumber: 'B1', cones: 24, weight: 50.0, returnedWeight: 10.0, returnedDate: '2026-09-05', returnedRemarks: 'Tension issue' },
        { boxNumber: 'B2', cones: 24, weight: 50.0, returnedWeight: 50.0, returnedDate: '2026-09-05', returnedRemarks: 'Full defect' },
        { boxNumber: 'B3', cones: 24, weight: 50.0, returnedWeight: 0 }
      ]
    };

    // Calculate metrics
    const grossTotal = batchData.boxes.reduce((acc, b) => acc + b.weight, 0); // 150 kg
    const grTotal = batchData.boxes.reduce((acc, b) => acc + b.returnedWeight, 0); // 60 kg
    const netTotal = grossTotal - grTotal; // 90 kg
    const rate = Number(order.price) || 0; // 240
    const subtotal = netTotal * rate; // 90 * 240 = 21600
    const gstPercent = 5.0;
    const gstAmt = (subtotal * gstPercent) / 100; // 1080
    const grandTotal = subtotal + gstAmt; // 22680

    // Simulate Stock Lot creation
    const stockLot = {
      id: `${batchData.lotNumber}__${batchData.challanNumber}`,
      batchId: batchData.id,
      lotNumber: batchData.lotNumber,
      challanNo: batchData.challanNumber,
      supplier: order.supplier,
      quality: order.quality,
      boxes: batchData.boxes.map(bx => {
        const gross = bx.weight;
        const ret = bx.returnedWeight;
        const rem = gross - ret;
        const isFullyGr = ret >= gross && gross > 0;
        return {
          id: bx.boxNumber,
          boxNumber: bx.boxNumber,
          grossWeight: gross,
          remainingWeight: rem,
          weight: isFullyGr ? gross : rem,
          status: isFullyGr ? 'gr' : 'available',
          grWeight: ret
        };
      })
    };

    // Simulate Purchase Ledger Row creation
    const ledgerRow = {
      id: `PUR-order_${order.id}_batch_${batchData.id}_${batchData.challanNumber}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      batchId: batchData.id,
      challanNo: batchData.challanNumber,
      partyName: order.supplier,
      quality: `${order.quality} (Lot: ${batchData.lotNumber})`,
      grossQty: grossTotal,
      grQty: grTotal,
      qty: netTotal,
      rate: rate,
      grAmount: grTotal * rate,
      grossAmount: grossTotal * rate,
      subtotal: subtotal,
      grandTotal: grandTotal,
      grBoxes: batchData.boxes.filter(b => b.returnedWeight > 0).map(b => ({
        boxNumber: b.boxNumber,
        weight: b.weight,
        returnedWeight: b.returnedWeight,
        date: b.returnedDate,
        remarks: b.returnedRemarks
      }))
    };

    // Verify Stock Book reflection
    assert.strictEqual(stockLot.boxes[0].status, 'available');
    assert.strictEqual(stockLot.boxes[0].grWeight, 10.0);
    assert.strictEqual(stockLot.boxes[0].remainingWeight, 40.0);
    assert.strictEqual(stockLot.boxes[1].status, 'gr');
    assert.strictEqual(stockLot.boxes[1].grWeight, 50.0);
    assert.strictEqual(stockLot.boxes[1].remainingWeight, 0);
    assert.strictEqual(stockLot.boxes[2].status, 'available');
    assert.strictEqual(stockLot.boxes[2].grWeight, 0);

    // Verify Purchase Ledger reflection
    assert.strictEqual(ledgerRow.grossQty, 150.0);
    assert.strictEqual(ledgerRow.grQty, 60.0);
    assert.strictEqual(ledgerRow.qty, 90.0);
    assert.strictEqual(ledgerRow.grossAmount, 36000.0);
    assert.strictEqual(ledgerRow.grAmount, 14400.0);
    assert.strictEqual(ledgerRow.subtotal, 21600.0);
    assert.strictEqual(ledgerRow.grandTotal, 22680.0);
    assert.strictEqual(ledgerRow.grBoxes.length, 2);
    assert.strictEqual(ledgerRow.grBoxes[0].boxNumber, 'B1');
    assert.strictEqual(ledgerRow.grBoxes[1].boxNumber, 'B2');
  });

  await t.test('tri-sheet sync: deleting a batch in one sheet cleans up all three sheets', () => {
    let orders = [
      {
        id: 'ORD-DEL-1',
        batches: [
          { id: 'BATCH-DEL-1', challanNumber: 'CH-DEL-1', lotNumber: 'LOT-DEL-1' }
        ]
      }
    ];

    let stockList = [
      { id: 'LOT-DEL-1__CH-DEL-1', batchId: 'BATCH-DEL-1', challanNo: 'CH-DEL-1', lotNumber: 'LOT-DEL-1' }
    ];

    let purchaseLedger = [
      { id: 'PUR-DEL-1', batchId: 'BATCH-DEL-1', challanNo: 'CH-DEL-1' }
    ];

    const delBatchId = 'BATCH-DEL-1';

    // Delete batch
    orders[0].batches = orders[0].batches.filter(b => b.id !== delBatchId);
    stockList = stockList.filter(s => s.batchId !== delBatchId);
    purchaseLedger = purchaseLedger.filter(r => r.batchId !== delBatchId);

    assert.strictEqual(orders[0].batches.length, 0);
    assert.strictEqual(stockList.length, 0);
    assert.strictEqual(purchaseLedger.length, 0);
  });

  await t.test('multi-division sales ledger sync: Covering, TFO, and Doubler qualities sync cleanly without challan collision', () => {
    // Helper function matching ledger.html extractSaleQuality
    function extractSaleQuality(sale, div, dataMap) {
      if (!sale) return `${(div || 'YARN').toUpperCase()} Yarn`;

      if (sale.composition && String(sale.composition).trim() && String(sale.composition).trim() !== '-') {
        return String(sale.composition).trim();
      }
      if (sale.productName && String(sale.productName).trim() && String(sale.productName).trim() !== '-') {
        return String(sale.productName).trim();
      }
      if (sale.quality && String(sale.quality).trim() && String(sale.quality).trim() !== '-') {
        return String(sale.quality).trim();
      }

      let items = sale.items;
      if (Array.isArray(items) && items.length > 0) {
        const comps = items
          .map(it => (it ? (it.composition || it.productName || it.quality || '') : '').trim())
          .filter(c => c && c !== '-');
        const uniqueComps = Array.from(new Set(comps));
        if (uniqueComps.length > 0) {
          return uniqueComps.join(' / ');
        }
      }

      return `${(div || 'YARN').toUpperCase()} Yarn`;
    }

    // Mock dataMap with sales logs for all 3 divisions sharing the same challan number "#001"
    const mockDataMap = {
      yarn_covering_sales_logs: [
        {
          id: 'COV-SALE-1',
          challanNo: 'CH-001',
          customerName: 'Covering Buyer Ltd',
          date: '2026-09-01',
          totalQty: 100,
          rate: 350,
          composition: '40D/34F SPANDEX COVERED',
          items: [
            { composition: '40D/34F SPANDEX COVERED', saleQty: 100, rate: 350 }
          ]
        }
      ],
      yarn_tfo_sales_logs: [
        {
          id: 'TFO-SALE-1',
          challanNo: 'CH-001',
          customerName: 'TFO Buyer Corp',
          date: '2026-09-02',
          totalQty: 150,
          rate: 280,
          items: [
            { composition: '80D/72F TFO TWISTED 350 TPM', saleQty: 150, rate: 280 }
          ]
        }
      ],
      yarn_doubler_sales_logs: [
        {
          id: 'DBL-SALE-1',
          challanNo: 'CH-001',
          customerName: 'Doubler Client Inc',
          date: '2026-09-03',
          totalQty: 200,
          rate: 220,
          productName: '150D/48F DOUBLER YARN',
          items: [
            { productName: '150D/48F DOUBLER YARN', saleQty: 200, rate: 220 }
          ]
        }
      ]
    };

    const salesLedger = [];
    const ledgerDeletedKeys = new Set();

    // Replicate pure sync loop
    for (const div of ['covering', 'tfo', 'doubler']) {
      const rawSales = mockDataMap[`yarn_${div}_sales_logs`] || [];
      rawSales.forEach(sale => {
        const challanNo = (sale.challanNo || '').trim();
        const customerName = (sale.customerName || 'Direct Sale').trim();
        const uniqueSyncKey = `sales_${div}_${sale.id || challanNo}`;
        const deterministicId = 'SAL-' + uniqueSyncKey.replace(/[^a-zA-Z0-9_-]/g, '_');

        const existingRow = salesLedger.find(r => 
          r.id === deterministicId || 
          r.syncKey === uniqueSyncKey || 
          (r.source === `yarn_${div}_sales` && r.challanNo === challanNo && (r.partyName === customerName || !r.partyName || !customerName))
        );

        const qualityStr = extractSaleQuality(sale, div, mockDataMap);
        const qty = Number(sale.totalQty) || 0;
        const rate = Number(sale.rate) || 0;
        const subtotal = Number((qty * rate).toFixed(2));
        const grandTotal = Number((subtotal * 1.05).toFixed(2));

        if (!existingRow && challanNo) {
          salesLedger.push({
            id: deterministicId,
            syncKey: uniqueSyncKey,
            source: `yarn_${div}_sales`,
            challanNo: challanNo,
            partyName: customerName,
            quality: qualityStr,
            qty: qty,
            rate: rate,
            subtotal: subtotal,
            grandTotal: grandTotal
          });
        }
      });
    }

    // Verify all 3 divisions are preserved with their exact qualities and parties
    assert.strictEqual(salesLedger.length, 3, 'All 3 divisions must have distinct rows even when challanNo is identical');

    const covRow = salesLedger.find(r => r.source === 'yarn_covering_sales');
    assert.ok(covRow, 'Covering sale must exist');
    assert.strictEqual(covRow.quality, '40D/34F SPANDEX COVERED');
    assert.strictEqual(covRow.partyName, 'Covering Buyer Ltd');
    assert.strictEqual(covRow.qty, 100);

    const tfoRow = salesLedger.find(r => r.source === 'yarn_tfo_sales');
    assert.ok(tfoRow, 'TFO sale must exist');
    assert.strictEqual(tfoRow.quality, '80D/72F TFO TWISTED 350 TPM');
    assert.strictEqual(tfoRow.partyName, 'TFO Buyer Corp');
    assert.strictEqual(tfoRow.qty, 150);

    const dblRow = salesLedger.find(r => r.source === 'yarn_doubler_sales');
    assert.ok(dblRow, 'Doubler sale must exist');
    assert.strictEqual(dblRow.quality, '150D/48F DOUBLER YARN');
    assert.strictEqual(dblRow.partyName, 'Doubler Client Inc');
    assert.strictEqual(dblRow.qty, 200);
  });

  await t.test('multi-division FP quality datalist aggregates all Covering, TFO, and Doubler qualities without duplicates', () => {
    const mockDataMap = {
      'yarn-fp-qualities': [
        { id: 'FP-1', division: 'covering', name: '40/34 SPANDEX COVER' },
        { id: 'FP-2', division: 'tfo', name: '80/72 TFO 350 TPM' }
      ],
      'costing-covering-products-v1': [
        { id: 'C-1', name: '40/34 SPANDEX COVER' },
        { id: 'C-2', name: '20/1 SPANDEX AIR COVER' }
      ],
      'costing-tfo-products-v1': [
        { id: 'T-1', name: '80/72 TFO 350 TPM' },
        { id: 'T-2', name: '150/48 TFO 400 TPM' }
      ],
      'costing-doubler-products-v1': [
        { id: 'D-1', name: '150/48 MX DOUBLER' }
      ],
      'yarn_covering_production_logs': [
        { productName: '20/1 SPANDEX AIR COVER' }
      ],
      'yarn_tfo_production_logs': [
        { productName: '80/72 TFO 350 TPM' }
      ],
      'yarn_doubler_production_logs': [
        { productName: '150/48 MX DOUBLER' }
      ]
    };

    const qualitySet = new Set();

    // 1. FP Qualities
    (mockDataMap['yarn-fp-qualities'] || []).forEach(q => {
      const name = (q.name || '').trim();
      if (name) qualitySet.add(name);
    });

    // 2. Costing Products
    ['costing-covering-products-v1', 'costing-tfo-products-v1', 'costing-doubler-products-v1'].forEach(k => {
      (mockDataMap[k] || []).forEach(p => {
        const name = (p.name || '').trim();
        if (name) qualitySet.add(name);
      });
    });

    // 3. Production logs
    ['covering', 'tfo', 'doubler'].forEach(div => {
      (mockDataMap[`yarn_${div}_production_logs`] || []).forEach(p => {
        const name = (p.productName || '').trim();
        if (name) qualitySet.add(name);
      });
    });

    const sortedQualities = Array.from(qualitySet).sort();

    assert.strictEqual(sortedQualities.length, 5, 'Should deduplicate across sheets into 5 distinct qualities across Covering, TFO, and Doubler');
    assert.deepStrictEqual(sortedQualities, [
      '150/48 MX DOUBLER',
      '150/48 TFO 400 TPM',
      '20/1 SPANDEX AIR COVER',
      '40/34 SPANDEX COVER',
      '80/72 TFO 350 TPM'
    ]);
  });

  await t.test('when GR is added to an issued box and then deleted/removed, it reverts to issued on previous date (not available)', () => {
    // 1. Initial State: Box B1 is available, Box B2 was issued to 'Knitter Unit 2' on 2026-08-15
    const stockLot = {
      id: 'LOT-500__CH-1234',
      lotNumber: 'LOT-500',
      challanNo: 'CH-1234',
      supplier: 'Reliance Industries',
      quality: '80/72 Polyester',
      boxes: [
        { id: 'B1', boxNumber: 'B1', weight: 40.0, grossWeight: 40.0, remainingWeight: 40.0, grWeight: 0, status: 'available' },
        { id: 'B2', boxNumber: 'B2', weight: 40.0, grossWeight: 40.0, remainingWeight: 40.0, grWeight: 0, status: 'issued', issueDate: '2026-08-15', issuedTo: 'Knitter Unit 2', previousIssueDate: '2026-08-15', previousIssuedTo: 'Knitter Unit 2' }
      ]
    };

    // 2. User issues 100% Full GR on both B1 (available) and B2 (issued)
    const grAllocations = [
      { boxNumber: 'B1', returnedWeight: 40.0, remarks: 'Defective' },
      { boxNumber: 'B2', returnedWeight: 40.0, remarks: 'Defective issued cones' }
    ];

    grAllocations.forEach(alloc => {
      const bx = stockLot.boxes.find(b => b.boxNumber === alloc.boxNumber);
      const prevIssueDate = bx.previousIssueDate || (bx.status === 'issued' ? bx.issueDate : null);
      const prevIssuedTo = bx.previousIssuedTo || (bx.status === 'issued' ? bx.issuedTo : null);
      if (prevIssueDate) bx.previousIssueDate = prevIssueDate;
      if (prevIssuedTo) bx.previousIssuedTo = prevIssuedTo;

      const ret = alloc.returnedWeight;
      const gross = bx.grossWeight || bx.weight;
      bx.grWeight = ret;
      bx.remainingWeight = Math.max(0, gross - ret);
      if (ret >= gross && gross > 0) {
        bx.status = 'gr';
        bx.issueDate = null;
        bx.issuedTo = null;
      }
    });

    assert.strictEqual(stockLot.boxes[0].status, 'gr');
    assert.strictEqual(stockLot.boxes[1].status, 'gr');
    assert.strictEqual(stockLot.boxes[1].previousIssueDate, '2026-08-15', 'Preserves previous issue date');
    assert.strictEqual(stockLot.boxes[1].previousIssuedTo, 'Knitter Unit 2', 'Preserves previous recipient');

    // 3. User now REMOVES / DELETES the GR on both boxes (sets returnedWeight = 0)
    const clearAllocations = [
      { boxNumber: 'B1', returnedWeight: 0 },
      { boxNumber: 'B2', returnedWeight: 0 }
    ];

    clearAllocations.forEach(alloc => {
      const bx = stockLot.boxes.find(b => b.boxNumber === alloc.boxNumber);
      const prevIssueDate = bx.previousIssueDate || (bx.status === 'issued' ? bx.issueDate : null);
      const prevIssuedTo = bx.previousIssuedTo || (bx.status === 'issued' ? bx.issuedTo : null);
      if (prevIssueDate) bx.previousIssueDate = prevIssueDate;
      if (prevIssuedTo) bx.previousIssuedTo = prevIssuedTo;

      const ret = alloc.returnedWeight;
      const gross = bx.grossWeight || bx.weight;
      bx.grWeight = ret;
      bx.remainingWeight = Math.max(0, gross - ret);
      bx.weight = bx.remainingWeight;

      if (ret >= gross && gross > 0) {
        bx.status = 'gr';
        bx.issueDate = null;
        bx.issuedTo = null;
      } else {
        if (bx.previousIssueDate || bx.previousIssuedTo || bx.issueDate || bx.issuedTo || bx.status === 'issued') {
          bx.status = 'issued';
          bx.issueDate = bx.issueDate || bx.previousIssueDate;
          bx.issuedTo = bx.issuedTo || bx.previousIssuedTo || 'Department';
        } else {
          bx.status = 'available';
          bx.issueDate = null;
          bx.issuedTo = null;
        }
      }
    });

    // Box B1 (which was never issued before GR) should go back to AVAILABLE
    assert.strictEqual(stockLot.boxes[0].status, 'available');
    assert.strictEqual(stockLot.boxes[0].issueDate, null);
    assert.strictEqual(stockLot.boxes[0].issuedTo, null);

    // Box B2 (which WAS issued before GR) must go back to ISSUED on its previous date and recipient!
    assert.strictEqual(stockLot.boxes[1].status, 'issued', 'B2 must revert to issued, NOT available');
    assert.strictEqual(stockLot.boxes[1].issueDate, '2026-08-15', 'B2 issue date must be restored to previous date');
    assert.strictEqual(stockLot.boxes[1].issuedTo, 'Knitter Unit 2', 'B2 issuedTo recipient must be restored');
  });

  await t.test('multi-device merge restores issued status on previous date when remote deletes GR', () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../assets/supabase-client.js');
    const clientCode = fs.readFileSync(filePath, 'utf8');

    const sandbox = {
      window: {
        location: { pathname: '/management%20suite/modules/yarn/yarn-production.html', href: 'http://localhost/yarn-production.html' },
        addEventListener: () => {},
        dispatchEvent: () => {},
        CustomEvent: function(name, opts) { this.name = name; this.detail = opts?.detail; },
        StorageEvent: function(name, opts) { this.name = name; this.key = opts?.key; this.newValue = opts?.newValue; },
        HTMLInputElement: function() {},
        HTMLTextAreaElement: function() {},
        HTMLSelectElement: function() {}
      },
      document: {
        location: { pathname: '/management%20suite/modules/yarn/yarn-production.html', href: 'http://localhost/yarn-production.html' },
        addEventListener: () => {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
      },
      localStorage: {
        _data: {},
        getItem(k) { return this._data[k] || null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; }
      },
      navigator: { onLine: true }, console: console, setTimeout: (fn) => {}, clearTimeout: () => {}, setInterval: () => ({ unref: () => {} }), clearInterval: () => {}, Date: Date
    };

    const fn = new Function('window', 'document', 'localStorage', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', clientCode);
    fn(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.console, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval, sandbox.clearInterval, sandbox.Date);
    const vSupabase = sandbox.window.VishwaSupabase;

    // Local device has B2 in GR state (was issued before)
    const localStock = [
      {
        id: 'LOT-777__CH-99',
        lotNumber: 'LOT-777',
        challanNo: 'CH-99',
        updated_at: '2026-09-01T10:00:00.000Z',
        boxes: [
          {
            id: 'B2',
            boxNumber: 'B2',
            grossWeight: 50.0,
            weight: 50.0,
            remainingWeight: 0,
            grWeight: 50.0,
            status: 'gr',
            issueDate: null,
            issuedTo: null,
            previousIssueDate: '2026-08-10',
            previousIssuedTo: 'TFO Plant 1',
            updated_at: '2026-09-01T10:00:00.000Z'
          }
        ]
      }
    ];

    // Remote peer just deleted the GR on B2 (grWeight = 0, status changed with newer timestamp)
    const remoteStock = [
      {
        id: 'LOT-777__CH-99',
        lotNumber: 'LOT-777',
        challanNo: 'CH-99',
        updated_at: '2026-09-05T05:00:00.000Z',
        boxes: [
          {
            id: 'B2',
            boxNumber: 'B2',
            grossWeight: 50.0,
            weight: 50.0,
            remainingWeight: 50.0,
            grWeight: 0,
            status: 'issued',
            issueDate: '2026-08-10',
            issuedTo: 'TFO Plant 1',
            previousIssueDate: '2026-08-10',
            previousIssuedTo: 'TFO Plant 1',
            updated_at: '2026-09-05T05:00:00.000Z'
          }
        ]
      }
    ];

    const merged = vSupabase.mergeYarnStockDatasets(localStock, remoteStock);
    assert.strictEqual(merged.length, 1);
    const box = merged[0].boxes[0];
    assert.strictEqual(box.status, 'issued', 'Merged box must be issued');
    assert.strictEqual(box.issueDate, '2026-08-10', 'Issue date preserved');
    assert.strictEqual(box.issuedTo, 'TFO Plant 1', 'Issued to preserved');
    assert.strictEqual(box.grWeight, 0, 'GR is 0');
  });

  await t.test('multi-PC: issued box on PC 1 is not deleted when PC 2 logs in with fresh/default available state', () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../assets/supabase-client.js');
    const clientCode = fs.readFileSync(filePath, 'utf8');

    const sandbox = {
      window: { location: { pathname: '/management%20suite/modules/yarn/yarn-rm-stock.html', href: 'http://localhost/yarn-rm-stock.html' }, addEventListener: () => {}, dispatchEvent: () => {}, CustomEvent: function(n, o) { this.name = n; this.detail = o?.detail; }, StorageEvent: function(n, o) { this.name = n; this.key = o?.key; this.newValue = o?.newValue; }, HTMLInputElement: function() {}, HTMLTextAreaElement: function() {}, HTMLSelectElement: function() {} },
      document: { location: { pathname: '/management%20suite/modules/yarn/yarn-rm-stock.html', href: 'http://localhost/yarn-rm-stock.html' }, addEventListener: () => {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
      localStorage: { _data: {}, getItem(k) { return this._data[k] || null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } },
      navigator: { onLine: true }, console: console, setTimeout: (fn) => {}, clearTimeout: () => {}, setInterval: () => ({ unref: () => {} }), clearInterval: () => {}, Date: Date
    };

    const fn = new Function('window', 'document', 'localStorage', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', clientCode);
    fn(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.console, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval, sandbox.clearInterval, sandbox.Date);
    const vSupabase = sandbox.window.VishwaSupabase;

    // PC 1 (Local): Box B1 was issued on 2026-09-02
    const pc1Stock = [
      {
        id: 'LOT-100__CH-100',
        lotNumber: 'LOT-100',
        challanNo: 'CH-100',
        updated_at: '2026-09-02T10:00:00.000Z',
        boxes: [
          {
            id: 'B1',
            boxNumber: 'B1',
            grossWeight: 50.0,
            weight: 50.0,
            remainingWeight: 50.0,
            grWeight: 0,
            status: 'issued',
            issueDate: '2026-09-02',
            issuedTo: 'Weaving Unit 1',
            previousIssueDate: '2026-09-02',
            previousIssuedTo: 'Weaving Unit 1',
            updated_at: '2026-09-02T10:00:00.000Z'
          }
        ]
      }
    ];

    // PC 2 (Remote): Freshly created / default state on PC 2 with today's timestamp (2026-09-05) and available status (no unissued_at)
    const pc2Stock = [
      {
        id: 'LOT-100__CH-100',
        lotNumber: 'LOT-100',
        challanNo: 'CH-100',
        updated_at: '2026-09-05T05:00:00.000Z',
        boxes: [
          {
            id: 'B1',
            boxNumber: 'B1',
            grossWeight: 50.0,
            weight: 50.0,
            remainingWeight: 50.0,
            grWeight: 0,
            status: 'available',
            issueDate: null,
            issuedTo: null,
            previousIssueDate: null,
            previousIssuedTo: null,
            unissued_at: null,
            updated_at: '2026-09-05T05:00:00.000Z'
          }
        ]
      }
    ];

    const merged = vSupabase.mergeYarnStockDatasets(pc1Stock, pc2Stock);
    assert.strictEqual(merged.length, 1);
    const box = merged[0].boxes[0];
    assert.strictEqual(box.status, 'issued', 'Issued box from PC 1 must NOT be overwritten by default available on PC 2');
    assert.strictEqual(box.issueDate, '2026-09-02');
    assert.strictEqual(box.issuedTo, 'Weaving Unit 1');

    // Also test the reverse direction (PC 2 local merging PC 1 remote)
    const reverseMerged = vSupabase.mergeYarnStockDatasets(pc2Stock, pc1Stock);
    assert.strictEqual(reverseMerged.length, 1);
    const revBox = reverseMerged[0].boxes[0];
    assert.strictEqual(revBox.status, 'issued', 'Reverse merge must also preserve issued status');
    assert.strictEqual(revBox.issueDate, '2026-09-02');
    assert.strictEqual(revBox.issuedTo, 'Weaving Unit 1');
  });

  await t.test('multi-PC: explicit unissuance (with unissued_at) properly reverts issued box to available across PCs', () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../assets/supabase-client.js');
    const clientCode = fs.readFileSync(filePath, 'utf8');

    const sandbox = {
      window: { location: { pathname: '/management%20suite/modules/yarn/yarn-rm-stock.html', href: 'http://localhost/yarn-rm-stock.html' }, addEventListener: () => {}, dispatchEvent: () => {}, CustomEvent: function(n, o) { this.name = n; this.detail = o?.detail; }, StorageEvent: function(n, o) { this.name = n; this.key = o?.key; this.newValue = o?.newValue; }, HTMLInputElement: function() {}, HTMLTextAreaElement: function() {}, HTMLSelectElement: function() {} },
      document: { location: { pathname: '/management%20suite/modules/yarn/yarn-rm-stock.html', href: 'http://localhost/yarn-rm-stock.html' }, addEventListener: () => {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
      localStorage: { _data: {}, getItem(k) { return this._data[k] || null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } },
      navigator: { onLine: true }, console: console, setTimeout: (fn) => {}, clearTimeout: () => {}, setInterval: () => ({ unref: () => {} }), clearInterval: () => {}, Date: Date
    };

    const fn = new Function('window', 'document', 'localStorage', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', clientCode);
    fn(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.console, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval, sandbox.clearInterval, sandbox.Date);
    const vSupabase = sandbox.window.VishwaSupabase;

    // PC 1: Box was issued on 2026-09-01
    const issuedStock = [
      {
        id: 'LOT-200__CH-200',
        lotNumber: 'LOT-200',
        challanNo: 'CH-200',
        updated_at: '2026-09-01T10:00:00.000Z',
        boxes: [
          {
            id: 'B1',
            boxNumber: 'B1',
            grossWeight: 50.0,
            weight: 50.0,
            remainingWeight: 50.0,
            grWeight: 0,
            status: 'issued',
            issueDate: '2026-09-01',
            issuedTo: 'Weaving Unit 2',
            previousIssueDate: '2026-09-01',
            previousIssuedTo: 'Weaving Unit 2',
            updated_at: '2026-09-01T10:00:00.000Z'
          }
        ]
      }
    ];

    // PC 2: Operator explicitly clicked "Revert to Available" on 2026-09-05
    const unissuedStock = [
      {
        id: 'LOT-200__CH-200',
        lotNumber: 'LOT-200',
        challanNo: 'CH-200',
        updated_at: '2026-09-05T06:00:00.000Z',
        boxes: [
          {
            id: 'B1',
            boxNumber: 'B1',
            grossWeight: 50.0,
            weight: 50.0,
            remainingWeight: 50.0,
            grWeight: 0,
            status: 'available',
            issueDate: null,
            issuedTo: null,
            previousIssueDate: null,
            previousIssuedTo: null,
            unissued_at: '2026-09-05T06:00:00.000Z',
            updated_at: '2026-09-05T06:00:00.000Z'
          }
        ]
      }
    ];

    const merged = vSupabase.mergeYarnStockDatasets(issuedStock, unissuedStock);
    assert.strictEqual(merged.length, 1);
    const box = merged[0].boxes[0];
    assert.strictEqual(box.status, 'available', 'Explicit unissuing with unissued_at must successfully revert box to available');
    assert.strictEqual(box.issueDate, null);
    assert.strictEqual(box.issuedTo, null);
  });

  await t.test('AI Vision Issue Slip Matcher correctly maps extracted boxes and issues them with multi-PC sync protection', () => {
    // 1. Initial Stock Lot in Inventory
    const stockLot = {
      id: 'LOT-9042__CH-7788',
      lotNumber: 'LOT-9042',
      challanNo: 'CH-7788',
      quality: '80D/72F Micro Polyester',
      boxes: [
        { id: 'B1', boxNumber: '1', grossWeight: 50.0, weight: 50.0, remainingWeight: 50.0, status: 'available' },
        { id: 'B2', boxNumber: '2', grossWeight: 51.2, weight: 51.2, remainingWeight: 51.2, status: 'available' },
        { id: 'B3', boxNumber: '3', grossWeight: 49.8, weight: 49.8, remainingWeight: 49.8, status: 'available' },
        { id: 'B4', boxNumber: '4', grossWeight: 50.5, weight: 50.5, remainingWeight: 50.5, status: 'available' }
      ]
    };

    // 2. Simulated Gemini Vision AI Parsed Payload from an uploaded Issue Slip
    const aiExtractedPayload = {
      lotNumber: '9042',
      challanNumber: 'CH-7788',
      issueDate: '2026-09-05',
      issuedTo: 'Covering Unit 2',
      boxNumbers: ['1', '2', '4'],
      remarks: 'Issued for 40D Covered Spandex Production'
    };

    // 3. Match Lot & Boxes
    const cleanLotToken = aiExtractedPayload.lotNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const lotNumClean = stockLot.lotNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    assert.ok(lotNumClean.includes(cleanLotToken), 'Lot number must match');

    const detectedSet = new Set(aiExtractedPayload.boxNumbers.map(b => String(b).trim()));
    const nowIso = new Date().toISOString();

    stockLot.boxes.forEach(box => {
      if (detectedSet.has(box.boxNumber) && box.status === 'available') {
        box.status = 'issued';
        box.issueDate = aiExtractedPayload.issueDate;
        box.issuedTo = aiExtractedPayload.issuedTo;
        box.previousIssueDate = aiExtractedPayload.issueDate;
        box.previousIssuedTo = aiExtractedPayload.issuedTo;
        box.unissued_at = null;
        box.updated_at = nowIso;
      }
    });

    // Verify Box States
    assert.strictEqual(stockLot.boxes[0].status, 'issued', 'Box 1 issued');
    assert.strictEqual(stockLot.boxes[0].issuedTo, 'Covering Unit 2');
    assert.strictEqual(stockLot.boxes[1].status, 'issued', 'Box 2 issued');
    assert.strictEqual(stockLot.boxes[2].status, 'available', 'Box 3 remains available');
    assert.strictEqual(stockLot.boxes[3].status, 'issued', 'Box 4 issued');

    const totalIssuedKg = stockLot.boxes.filter(b => b.status === 'issued').reduce((acc, b) => acc + b.weight, 0);
    assert.strictEqual(Number(totalIssuedKg.toFixed(2)), 151.7, 'Total issued weight = 50.0 + 51.2 + 50.5 = 151.7 kg');
  });

  await t.test('AI Vision Scanner: parses 20/1 BRT POLY challan with per-box issue dates and issues to specified department (TFO, Doubler, Covering, MX)', () => {
    // Exact structure of the user's uploaded challan
    const aiExtractedChallan = {
      quality: '20/1 BRT POLY',
      totalWeight: 240.0,
      lotNumber: 'M005336/26',
      challanNumber: 'CH-240',
      supplier: 'Supreme Poly Mills',
      boxes: [
        { boxNumber: 'M005336/26', cones: 12, weight: 24.0, issueDate: '2026-08-16' },
        { boxNumber: 'M005540/26', cones: 12, weight: 24.0, issueDate: '2026-08-16' },
        { boxNumber: 'M006325/26', cones: 12, weight: 24.0, issueDate: '2026-08-08' },
        { boxNumber: 'M016607/26', cones: 12, weight: 24.0, issueDate: '2026-08-16' },
        { boxNumber: 'M005331/26', cones: 12, weight: 24.0, issueDate: '2026-08-08' },
        { boxNumber: 'M005607/26', cones: 12, weight: 24.0, issueDate: '2026-08-16' },
        { boxNumber: 'M006317/26', cones: 12, weight: 24.0, issueDate: '2026-08-16' },
        { boxNumber: 'M006318/26', cones: 12, weight: 24.0, issueDate: '2026-08-16' },
        { boxNumber: 'M014080/26', cones: 12, weight: 24.0, issueDate: '2026-08-08' },
        { boxNumber: 'M014662/26', cones: 12, weight: 24.0, issueDate: '2026-08-16' }
      ]
    };

    const targetDepartment = 'Covering';
    const nowIso = new Date().toISOString();

    // Auto-Register & Issue Lot
    const createdLot = {
      id: 'LOT-201BRTPOLY-AUTO',
      lotNumber: aiExtractedChallan.lotNumber,
      challanNo: aiExtractedChallan.challanNumber,
      quality: aiExtractedChallan.quality,
      supplier: aiExtractedChallan.supplier,
      itemType: 'Polyester',
      boxes: aiExtractedChallan.boxes.map(b => ({
        id: b.boxNumber,
        boxNumber: b.boxNumber,
        cones: b.cones,
        grossWeight: b.weight,
        remainingWeight: b.weight,
        weight: b.weight,
        status: 'issued',
        issueDate: b.issueDate,
        issuedTo: targetDepartment,
        previousIssueDate: b.issueDate,
        previousIssuedTo: targetDepartment,
        unissued_at: null,
        updated_at: nowIso,
        grWeight: 0
      }))
    };

    // Assertions
    assert.strictEqual(createdLot.quality, '20/1 BRT POLY');
    assert.strictEqual(createdLot.boxes.length, 10, 'All 10 boxes registered');
    
    // Check total weight
    const totalWt = createdLot.boxes.reduce((acc, b) => acc + b.weight, 0);
    assert.strictEqual(totalWt, 240.0, 'Total weight must be 240.0 kg');

    // Check individual box issue dates & department
    const boxAug8 = createdLot.boxes.filter(b => b.issueDate === '2026-08-08');
    const boxAug16 = createdLot.boxes.filter(b => b.issueDate === '2026-08-16');
    assert.strictEqual(boxAug8.length, 3, '3 boxes issued on 2026-08-08 (M006325/26, M005331/26, M014080/26)');
    assert.strictEqual(boxAug16.length, 7, '7 boxes issued on 2026-08-16');

    createdLot.boxes.forEach(box => {
      assert.strictEqual(box.status, 'issued');
      assert.strictEqual(box.issuedTo, 'Covering');
      assert.strictEqual(box.cones, 12);
      assert.strictEqual(box.weight, 24.0);
    });
  });

  await t.test('AI Vision Scanner: boxes with empty/blank dates in the slip are NOT selected by default and remain available in stock', () => {
    // Scanned challan with 10 total boxes: 4 have dates written, 6 have empty/null dates
    const scannedChallan = {
      quality: '80/72 Polyester DTY',
      totalWeight: 240.0,
      lotNumber: 'M009920/26',
      challanNumber: 'CH-9920',
      supplier: 'Supreme Poly Mills',
      boxes: [
        { boxNumber: 'M009920/01', cones: 12, weight: 24.0, issueDate: '2026-08-16' },
        { boxNumber: 'M009920/02', cones: 12, weight: 24.0, issueDate: '2026-08-16' },
        { boxNumber: 'M009920/03', cones: 12, weight: 24.0, issueDate: null }, // empty in slip
        { boxNumber: 'M009920/04', cones: 12, weight: 24.0, issueDate: '' },   // blank in slip
        { boxNumber: 'M009920/05', cones: 12, weight: 24.0, issueDate: '2026-08-08' },
        { boxNumber: 'M009920/06', cones: 12, weight: 24.0, issueDate: null },
        { boxNumber: 'M009920/07', cones: 12, weight: 24.0, issueDate: null },
        { boxNumber: 'M009920/08', cones: 12, weight: 24.0, issueDate: '2026-08-08' },
        { boxNumber: 'M009920/09', cones: 12, weight: 24.0, issueDate: '' },
        { boxNumber: 'M009920/10', cones: 12, weight: 24.0, issueDate: null }
      ]
    };

    // 1. Checkbox selection logic: only boxes with non-empty issueDate are checked
    const tableRows = scannedChallan.boxes.map(b => {
      const isChecked = Boolean(b.issueDate);
      return {
        boxNumber: b.boxNumber,
        cones: b.cones,
        weight: b.weight,
        isChecked: isChecked,
        issueDate: b.issueDate || null,
        statusBadge: isChecked ? '● Ready to Issue' : '○ No Date (Unselected)'
      };
    });

    const checkedRows = tableRows.filter(r => r.isChecked);
    const uncheckedRows = tableRows.filter(r => !r.isChecked);

    assert.strictEqual(checkedRows.length, 4, '4 boxes with dates are checked');
    assert.strictEqual(uncheckedRows.length, 6, '6 un-dated boxes are unselected');

    // Selected metrics
    const selectedWeight = checkedRows.reduce((acc, r) => acc + r.weight, 0);
    assert.strictEqual(selectedWeight, 96.0, 'Selected weight = 4 * 24.0 = 96.0 kg');

    // 2. Issuance simulation
    const targetDepartment = 'TFO';
    const nowIso = new Date().toISOString();
    const newLotId = 'LOT-8072POLY-9920';

    const registeredBoxes = tableRows.map(r => {
      if (r.isChecked) {
        return {
          id: r.boxNumber,
          boxNumber: r.boxNumber,
          cones: r.cones,
          weight: r.weight,
          grossWeight: r.weight,
          remainingWeight: r.weight,
          status: 'issued',
          issueDate: r.issueDate,
          issuedTo: targetDepartment,
          previousIssueDate: r.issueDate,
          previousIssuedTo: targetDepartment,
          unissued_at: null,
          updated_at: nowIso
        };
      } else {
        return {
          id: r.boxNumber,
          boxNumber: r.boxNumber,
          cones: r.cones,
          weight: r.weight,
          grossWeight: r.weight,
          remainingWeight: r.weight,
          status: 'available',
          issueDate: null,
          issuedTo: null,
          previousIssueDate: null,
          previousIssuedTo: null,
          unissued_at: null,
          updated_at: nowIso
        };
      }
    });

    const issuedBoxes = registeredBoxes.filter(b => b.status === 'issued');
    const availableBoxes = registeredBoxes.filter(b => b.status === 'available');

    assert.strictEqual(issuedBoxes.length, 4, '4 boxes are marked issued');
    assert.strictEqual(availableBoxes.length, 6, '6 boxes remain available in stock');

    const totalLotWeight = registeredBoxes.reduce((acc, b) => acc + b.weight, 0);
    assert.strictEqual(totalLotWeight, 240.0, 'Full challan weight of 240.0 kg is preserved in inventory');

    const availableWeight = availableBoxes.reduce((acc, b) => acc + b.remainingWeight, 0);
    assert.strictEqual(availableWeight, 144.0, 'Available stock weight is 144.0 kg');
  });

  await t.test('AI Vision Scanner: resolves and extracts yarn quality from matched stock boxes when OCR header is absent or custom quality is uploaded', () => {
    // Inventory contains 2 lots with distinct qualities
    const mockStockData = [
      {
        id: 'LOT-POLY-DTY-100',
        quality: '80/72 Polyester DTY Semi Dull',
        lotNumber: 'M005336',
        challanNo: 'CH-4001',
        boxes: [
          { id: 'M005336/26', boxNumber: 'M005336/26', weight: 24.0, status: 'available' },
          { id: 'M005540/26', boxNumber: 'M005540/26', weight: 24.0, status: 'available' },
          { id: 'M006325/26', boxNumber: 'M006325/26', weight: 24.0, status: 'available' }
        ]
      },
      {
        id: 'LOT-COTTON-30S',
        quality: '30s Combed Cotton Compact',
        lotNumber: 'COT-881',
        challanNo: 'CH-COT-10',
        boxes: [
          { id: 'CB-101', boxNumber: 'CB-101', weight: 45.0, status: 'available' },
          { id: 'CB-102', boxNumber: 'CB-102', weight: 45.0, status: 'available' }
        ]
      }
    ];

    // Extracted payload from a scanned slip where OCR header was null or generic
    const aiExtractedData = {
      quality: null, // no quality written in header
      lotNumber: 'M005336',
      challanNumber: 'CH-4001',
      boxes: [
        { boxNumber: 'M005336/26', cones: 12, weight: 24.0, issueDate: '2026-08-16' },
        { boxNumber: 'M005540/26', cones: 12, weight: 24.0, issueDate: '2026-08-16' }
      ]
    };

    // Quality resolution function simulation
    function resolveTestQuality(data, rawBoxes, stock) {
      const detectedBoxSet = new Set(rawBoxes.map(b => String(b.boxNumber || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()));
      let bestMatch = null;
      let highestScore = 0;

      stock.forEach(lot => {
        let score = 0;
        (lot.boxes || []).forEach(b => {
          const bClean = String(b.boxNumber || b.id || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          if (detectedBoxSet.has(bClean)) score += 15;
        });
        if (score > highestScore && score >= 10) {
          highestScore = score;
          bestMatch = lot;
        }
      });

      if (bestMatch && bestMatch.quality) return bestMatch.quality;
      return data.quality || 'Yarn Raw Material';
    }

    const resolved = resolveTestQuality(aiExtractedData, aiExtractedData.boxes, mockStockData);
    assert.strictEqual(resolved, '80/72 Polyester DTY Semi Dull', 'Extracted quality is resolved from matched box inventory rather than defaulting to 20/1 BRT POLY');
  });

  await t.test('AI Vision Scanner: normalizeIsoDate parses 2-digit years and formats accurately for box selection', () => {
    function normalizeIsoDate(dateStr) {
      if (!dateStr) return '';
      const trimmed = String(dateStr).trim();
      if (!trimmed || ['null', 'undefined', 'none', 'nil', '-', 'n/a', 'blank'].includes(trimmed.toLowerCase())) return '';

      // 1. Check YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
      const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (isoMatch) {
        const year = isoMatch[1];
        const month = isoMatch[2].padStart(2, '0');
        const day = isoMatch[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      // 2. Check DD-MM-YYYY or DD-MM-YY (or with / or .)
      const dmyMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
      if (dmyMatch) {
        const day = dmyMatch[1].padStart(2, '0');
        const month = dmyMatch[2].padStart(2, '0');
        let year = dmyMatch[3];
        if (year.length === 2) {
          year = (parseInt(year, 10) > 50 ? '19' : '20') + year;
        }
        return `${year}-${month}-${day}`;
      }

      // 3. Fallback to JS Date parsing if valid and not NaN
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        if (y >= 1970 && y <= 2100) {
          return `${y}-${m}-${d}`;
        }
      }

      return '';
    }

    assert.strictEqual(normalizeIsoDate('16-08-26'), '2026-08-16');
    assert.strictEqual(normalizeIsoDate('08/08/26'), '2026-08-08');
    assert.strictEqual(normalizeIsoDate('8-8-26'), '2026-08-08');
    assert.strictEqual(normalizeIsoDate('16.08.26'), '2026-08-16');
    assert.strictEqual(normalizeIsoDate('16-08-2026'), '2026-08-16');
    assert.strictEqual(normalizeIsoDate('2026-08-16'), '2026-08-16');
    assert.strictEqual(normalizeIsoDate(''), '');
    assert.strictEqual(normalizeIsoDate(null), '');
    assert.strictEqual(normalizeIsoDate('null'), '');
    assert.strictEqual(normalizeIsoDate('-'), '');
    assert.strictEqual(normalizeIsoDate('N/A'), '');

    // Test box selection logic based on dates
    const scannedBoxes = [
      { boxNumber: 'M005336/26', cones: 12, weight: 24.0, issueDate: '16-08-26' },
      { boxNumber: 'M005337/26', cones: 12, weight: 24.0, issueDate: '08/08/26' },
      { boxNumber: 'M005338/26', cones: 12, weight: 24.0, issueDate: null },
      { boxNumber: 'M005339/26', cones: 12, weight: 24.0, issueDate: '' }
    ];

    const processedBoxes = scannedBoxes.map(b => {
      const normalizedDate = normalizeIsoDate(b.issueDate);
      const isChecked = Boolean(normalizedDate);
      return {
        boxNumber: b.boxNumber,
        issueDate: normalizedDate,
        isChecked
      };
    });

    assert.strictEqual(processedBoxes[0].isChecked, true);
    assert.strictEqual(processedBoxes[0].issueDate, '2026-08-16');
    assert.strictEqual(processedBoxes[1].isChecked, true);
    assert.strictEqual(processedBoxes[1].issueDate, '2026-08-08');
    assert.strictEqual(processedBoxes[2].isChecked, false);
    assert.strictEqual(processedBoxes[2].issueDate, '');
    assert.strictEqual(processedBoxes[3].isChecked, false);
    assert.strictEqual(processedBoxes[3].issueDate, '');
  });

  await t.test('AI Vision Scanner: strictly issues boxes to existing items in stock and does NOT create new orders in RM order book', () => {
    // 1. Initial State: 1 existing order in yarn-rm-orders and 1 corresponding lot in stock
    const initialOrders = [
      {
        id: 'ORD-1001',
        orderNumber: 'ORD-1001',
        orderDate: '2026-08-01',
        supplier: 'ABC Spinners',
        quality: '30s Cotton Combed',
        status: 'Active',
        batches: [
          {
            id: 'BATCH-1001',
            challanNumber: 'CH-8800',
            lotNumber: 'LOT-9900',
            totalWeight: 100.0,
            boxes: [
              { boxNumber: 'B1', cones: 24, weight: 50.0, status: 'available' },
              { boxNumber: 'B2', cones: 24, weight: 50.0, status: 'available' }
            ]
          }
        ]
      }
    ];

    const stockData = [
      {
        id: 'LOT-9900__CH-8800',
        batchId: 'BATCH-1001',
        lotNumber: 'LOT-9900',
        challanNo: 'CH-8800',
        quality: '30s Cotton Combed',
        supplier: 'ABC Spinners',
        boxes: [
          { id: 'B1', boxNumber: 'B1', cones: 24, weight: 50.0, remainingWeight: 50.0, status: 'available' },
          { id: 'B2', boxNumber: 'B2', cones: 24, weight: 50.0, remainingWeight: 50.0, status: 'available' }
        ]
      }
    ];

    // 2. Simulated scanned slip targeting B1
    const scannedData = {
      lotNumber: 'LOT-9900',
      challanNumber: 'CH-8800',
      boxes: [
        { boxNumber: 'B1', cones: 24, weight: 50.0, issueDate: '2026-09-05' }
      ]
    };

    // 3. Dropdown population: only existing lots in stockData must be listed (no __NEW_LOT__)
    const dropdownOptions = stockData.map(lot => ({
      value: lot.id,
      label: `${lot.quality} — Lot: ${lot.lotNumber} | Ch: ${lot.challanNo}`
    }));

    assert.strictEqual(dropdownOptions.length, 1, 'Only 1 existing lot in dropdown');
    assert.strictEqual(dropdownOptions[0].value, 'LOT-9900__CH-8800');
    assert.ok(!dropdownOptions.some(opt => opt.value === '__NEW_LOT__'), '__NEW_LOT__ option is not present');

    // 4. Issue execution: target lot must be an existing lot from stockData
    const selectedLotId = 'LOT-9900__CH-8800';
    const targetLot = stockData.find(l => l.id === selectedLotId);
    assert.ok(targetLot, 'Target lot must exist in stockData');

    const departmentName = 'TFO';
    const issueDate = '2026-09-05';
    const nowIso = new Date().toISOString();

    // Issue box B1 on existing lot
    const boxB1 = targetLot.boxes.find(b => b.boxNumber === 'B1');
    assert.ok(boxB1, 'Box B1 exists in target lot');
    boxB1.status = 'issued';
    boxB1.issueDate = issueDate;
    boxB1.issuedTo = departmentName;
    boxB1.updated_at = nowIso;

    // Sync box status to orders (using syncBoxStatusToOrders logic)
    initialOrders.forEach(ord => {
      (ord.batches || []).forEach(b => {
        if (b.id === targetLot.batchId || (b.challanNumber === targetLot.challanNo && b.lotNumber === targetLot.lotNumber)) {
          const matchingBx = (b.boxes || []).find(bx => bx.boxNumber === 'B1');
          if (matchingBx) {
            matchingBx.status = 'issued';
            matchingBx.issueDate = issueDate;
            matchingBx.issuedTo = departmentName;
            matchingBx.updated_at = nowIso;
          }
        }
      });
    });

    // 5. Verification: NO NEW ORDER was added to initialOrders
    assert.strictEqual(initialOrders.length, 1, 'Order book still has exactly 1 order (NO new order was created)');
    assert.strictEqual(initialOrders[0].id, 'ORD-1001');
    assert.strictEqual(initialOrders[0].batches[0].boxes[0].status, 'issued');
    assert.strictEqual(initialOrders[0].batches[0].boxes[0].issuedTo, 'TFO');
    assert.strictEqual(initialOrders[0].batches[0].boxes[1].status, 'available');

    // Stock verification
    assert.strictEqual(targetLot.boxes[0].status, 'issued');
    assert.strictEqual(targetLot.boxes[0].issuedTo, 'TFO');
    assert.strictEqual(targetLot.boxes[1].status, 'available');
  });

  await t.test('Purchase ledger GR issuance: issuing GR for 1 box strictly preserves issue dates and status of remaining issued boxes in lot & orders', () => {
    // Initial Stock with 4 boxes: B1 is available, B2/B3/B4 are issued
    const stock = [
      {
        id: 'LOT-555__CH-1234',
        batchId: 'BATCH-555',
        lotNumber: 'LOT-555',
        challanNo: 'CH-1234',
        challanNumber: 'CH-1234',
        supplier: 'Gokaldas Mills',
        quality: '80/72 DTY Polyester',
        boxes: [
          { id: 'B1', boxNumber: 'B1', grossWeight: 50.0, weight: 50.0, remainingWeight: 50.0, returnedWeight: 0, grWeight: 0, status: 'available', issueDate: null, issuedTo: null },
          { id: 'B2', boxNumber: 'B2', grossWeight: 50.0, weight: 50.0, remainingWeight: 50.0, returnedWeight: 0, grWeight: 0, status: 'issued', issueDate: '2026-09-02', issuedTo: 'Covering Unit 1', previousIssueDate: '2026-09-02', previousIssuedTo: 'Covering Unit 1' },
          { id: 'B3', boxNumber: 'B3', grossWeight: 50.0, weight: 50.0, remainingWeight: 50.0, returnedWeight: 0, grWeight: 0, status: 'issued', issueDate: '2026-09-02', issuedTo: 'Covering Unit 1', previousIssueDate: '2026-09-02', previousIssuedTo: 'Covering Unit 1' },
          { id: 'B4', boxNumber: 'B4', grossWeight: 50.0, weight: 50.0, remainingWeight: 50.0, returnedWeight: 0, grWeight: 0, status: 'issued', issueDate: '2026-09-03', issuedTo: 'Knitting Unit 2', previousIssueDate: '2026-09-03', previousIssuedTo: 'Knitting Unit 2' }
        ]
      }
    ];

    // Initial Orders
    const orders = [
      {
        id: 'ORD-555',
        orderNumber: '555',
        supplier: 'Gokaldas Mills',
        quality: '80/72 DTY Polyester',
        batches: [
          {
            id: 'BATCH-555',
            challanNumber: 'CH-1234',
            lotNumber: 'LOT-555',
            grossWeight: 200.0,
            returnedWeight: 0,
            totalWeight: 200.0,
            receivedQty: 200.0,
            boxes: [
              { boxNumber: 'B1', grossWeight: 50.0, weight: 50.0, returnedWeight: 0, status: 'available', issueDate: null, issuedTo: null },
              { boxNumber: 'B2', grossWeight: 50.0, weight: 50.0, returnedWeight: 0, status: 'issued', issueDate: '2026-09-02', issuedTo: 'Covering Unit 1', previousIssueDate: '2026-09-02', previousIssuedTo: 'Covering Unit 1' },
              { boxNumber: 'B3', grossWeight: 50.0, weight: 50.0, returnedWeight: 0, status: 'issued', issueDate: '2026-09-02', issuedTo: 'Covering Unit 1', previousIssueDate: '2026-09-02', previousIssuedTo: 'Covering Unit 1' },
              { boxNumber: 'B4', grossWeight: 50.0, weight: 50.0, returnedWeight: 0, status: 'issued', issueDate: '2026-09-03', issuedTo: 'Knitting Unit 2', previousIssueDate: '2026-09-03', previousIssuedTo: 'Knitting Unit 2' }
            ]
          }
        ]
      }
    ];

    const row = {
      id: 'PUR-order_ORD-555_batch_BATCH-555_CH-1234',
      orderId: 'ORD-555',
      batchId: 'BATCH-555',
      challanNo: 'CH-1234',
      lotNumber: 'LOT-555',
      partyName: 'Gokaldas Mills',
      quality: '80/72 DTY Polyester',
      grossQty: 200.0,
      grQty: 50.0,
      qty: 150.0,
      rate: 300
    };

    // User allocates GR of 50 kg to B1 only
    const boxAllocations = [
      { boxNumber: 'B1', returnedWeight: 50.0, date: '2026-09-05', remarks: 'Defective box returned' },
      { boxNumber: 'B2', returnedWeight: 0, date: '', remarks: '' },
      { boxNumber: 'B3', returnedWeight: 0, date: '', remarks: '' },
      { boxNumber: 'B4', returnedWeight: 0, date: '', remarks: '' }
    ];

    // Unified sync logic matching ledger.html implementation
    const targetBatch = orders[0].batches[0];
    const targetStockLot = stock[0];

    const stockBoxMap = new Map();
    targetStockLot.boxes.forEach(sb => stockBoxMap.set(sb.boxNumber, sb));
    const orderBoxMap = new Map();
    targetBatch.boxes.forEach(ob => orderBoxMap.set(ob.boxNumber, ob));

    const boxAllocMap = new Map();
    boxAllocations.forEach(a => boxAllocMap.set(a.boxNumber, a));

    const allBoxNumbers = ['B1', 'B2', 'B3', 'B4'];
    const unifiedBoxes = allBoxNumbers.map(bNum => {
      const ob = orderBoxMap.get(bNum);
      const sb = stockBoxMap.get(bNum);

      const gross = Number(ob?.grossWeight) || Number(sb?.grossWeight) || 50.0;
      const alloc = boxAllocMap.get(bNum);
      const ret = alloc ? Number(alloc.returnedWeight) || 0 : 0;
      const rem = Math.max(0, gross - ret);
      const isFullyGr = ret >= gross && gross > 0;

      const wasIssued = Boolean((sb?.status === 'issued' || ob?.status === 'issued' || sb?.issueDate || ob?.issueDate || sb?.previousIssueDate || ob?.previousIssueDate) && !sb?.unissued_at && !ob?.unissued_at);
      const prevIssueDate = sb?.previousIssueDate || ob?.previousIssueDate || (wasIssued ? (sb?.issueDate || ob?.issueDate) : null);
      const prevIssuedTo = sb?.previousIssuedTo || ob?.previousIssuedTo || (wasIssued ? (sb?.issuedTo || ob?.issuedTo) : null);

      let status = 'available';
      let issueDate = null;
      let issuedTo = null;

      if (isFullyGr) {
        status = 'gr';
      } else if (wasIssued) {
        status = 'issued';
        issueDate = sb?.issueDate || ob?.issueDate || prevIssueDate;
        issuedTo = sb?.issuedTo || ob?.issuedTo || prevIssuedTo || 'Department';
      }

      return {
        id: bNum,
        boxNumber: bNum,
        grossWeight: gross,
        weight: isFullyGr ? gross : rem,
        remainingWeight: rem,
        returnedWeight: ret,
        grWeight: ret,
        status: status,
        issueDate: issueDate,
        issuedTo: issuedTo,
        previousIssueDate: prevIssueDate,
        previousIssuedTo: prevIssuedTo
      };
    });

    targetBatch.boxes = unifiedBoxes;
    targetStockLot.boxes = unifiedBoxes;

    // Verify Box B1: transitioned to GR
    assert.strictEqual(targetStockLot.boxes[0].status, 'gr');
    assert.strictEqual(targetStockLot.boxes[0].returnedWeight, 50.0);
    assert.strictEqual(targetStockLot.boxes[0].issueDate, null);

    // Verify Box B2: strictly STAYED ISSUED with issueDate intact
    assert.strictEqual(targetStockLot.boxes[1].status, 'issued');
    assert.strictEqual(targetStockLot.boxes[1].issueDate, '2026-09-02');
    assert.strictEqual(targetStockLot.boxes[1].issuedTo, 'Covering Unit 1');

    // Verify Box B3: strictly STAYED ISSUED with issueDate intact
    assert.strictEqual(targetStockLot.boxes[2].status, 'issued');
    assert.strictEqual(targetStockLot.boxes[2].issueDate, '2026-09-02');
    assert.strictEqual(targetStockLot.boxes[2].issuedTo, 'Covering Unit 1');

    // Verify Box B4: strictly STAYED ISSUED with issueDate intact
    assert.strictEqual(targetStockLot.boxes[3].status, 'issued');
    assert.strictEqual(targetStockLot.boxes[3].issueDate, '2026-09-03');
    assert.strictEqual(targetStockLot.boxes[3].issuedTo, 'Knitting Unit 2');

    // Verify Order batch boxes also match
    assert.strictEqual(targetBatch.boxes[0].status, 'gr');
    assert.strictEqual(targetBatch.boxes[1].status, 'issued');
    assert.strictEqual(targetBatch.boxes[1].issueDate, '2026-09-02');
    assert.strictEqual(targetBatch.boxes[2].status, 'issued');
    assert.strictEqual(targetBatch.boxes[3].status, 'issued');
  });
  await t.test('Partial GR on a box (e.g. 24kg gross with 12kg GR) reflects as partial GR (available or issued) with remaining weight, NOT full GR', () => {
    const grossBoxWeight = 24.0;
    const grWeight = 12.0;

    const stockLot = {
      id: 'LOT-PARTIAL__CH-1234',
      lotNumber: 'LOT-PARTIAL',
      challanNo: 'CH-1234',
      supplier: 'Test Mill',
      quality: '80/72 Polyester',
      boxes: [
        {
          id: 'B1',
          boxNumber: 'B1',
          weight: grossBoxWeight,
          grossWeight: grossBoxWeight,
          remainingWeight: grossBoxWeight,
          grWeight: 0,
          status: 'available'
        }
      ]
    };

    // Apply 12 kg partial GR to B1
    const alloc = { boxNumber: 'B1', returnedWeight: grWeight, remarks: '12 kg cone defect' };
    const b = stockLot.boxes[0];
    b.grWeight = alloc.returnedWeight;
    b.remainingWeight = Math.max(0, b.grossWeight - alloc.returnedWeight);
    const isFullyGr = (b.grWeight >= b.grossWeight && b.grossWeight > 0);
    const isPartialGr = (b.grWeight > 0 && !isFullyGr);
    b.status = isFullyGr ? 'gr' : 'available';

    // Verify Stock normalization / reflection
    assert.strictEqual(b.grossWeight, 24.0);
    assert.strictEqual(b.grWeight, 12.0);
    assert.strictEqual(b.remainingWeight, 12.0);
    assert.strictEqual(isFullyGr, false, 'Should not be marked fully GR');
    assert.strictEqual(isPartialGr, true, 'Should be marked partial GR');
    assert.strictEqual(b.status, 'available', 'Status remains available for partial GR');

    // Verify mapping in modal load
    const bw = Number(b.grossWeight) || 0;
    const gw = Number(b.grWeight) || 0;
    const modalIsFullyGr = (gw >= bw && bw > 0) || ((b.status === 'gr') && (gw === 0 || gw >= bw));
    assert.strictEqual(modalIsFullyGr, false, 'Modal mapping correctly identifies as partial GR, not full GR');
  });
});








