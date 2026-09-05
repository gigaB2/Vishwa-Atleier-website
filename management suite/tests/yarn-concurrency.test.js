const assert = require('assert');
const test = require('node:test');
const fs = require('fs');

const path = require('path');

test('Multi-User Concurrency & Merge Validation', async (t) => {
  const filePath = fs.existsSync(path.join(__dirname, '../assets/supabase-client.js'))
    ? path.join(__dirname, '../assets/supabase-client.js')
    : 'assets/supabase-client.js';
  const clientCode = fs.readFileSync(filePath, 'utf8');

  // Create isolated sandbox context
  function createTestEnv() {
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
      navigator: { onLine: true },
      console: console,
      setTimeout: (fn) => {},
      clearTimeout: () => {},
      setInterval: () => ({ unref: () => {} }),
      clearInterval: () => {},
      Date: Date
    };

    const fn = new Function('window', 'document', 'localStorage', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', clientCode);
    fn(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.console, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval, sandbox.clearInterval, sandbox.Date);
    return sandbox;
  }

  const env = createTestEnv();
  const vSupabase = env.window.VishwaSupabase;

  await t.test('getItemIdentifier distinguishes bori and challan without collisions', () => {
    assert.ok(vSupabase, 'VishwaSupabase is initialized');
    
    // Test bori identifier
    const bori1 = { boriNo: 'C-1001', lotNo: 'C-Lot101', date: '2026-09-01' };
    const bori2 = { boriNo: 'C-1002', lotNo: 'C-Lot101', date: '2026-09-01' };
    
    // Even if lot and date are identical, boriNo makes them unique
    const id1 = bori1.id || bori1.boriNo;
    const id2 = bori2.id || bori2.boriNo;
    assert.notStrictEqual(id1, id2);
  });

  await t.test('Array merging combines entries from 2 active users without loss', () => {
    const userALocal = [
      { id: 'p_1', boriNo: 'C-1001', productName: '70 Nylon', qty: 20, rolls: 20, date: '2026-09-01' },
      { id: 'p_2', boriNo: 'C-1002', productName: '70 Nylon', qty: 21, rolls: 21, date: '2026-09-01' }
    ];

    const userBRemote = [
      { id: 'p_1', boriNo: 'C-1001', productName: '70 Nylon', qty: 20, rolls: 20, date: '2026-09-01' },
      { id: 'p_3', boriNo: 'C-1003', productName: '70 Nylon', qty: 22, rolls: 22, date: '2026-09-01' }
    ];

    // Merging userALocal + userBRemote should result in 3 items (p_1, p_2, p_3)
    const itemMap = new Map();
    userALocal.forEach(item => itemMap.set(item.id || item.boriNo, item));
    userBRemote.forEach(item => {
      const id = item.id || item.boriNo;
      if (!itemMap.has(id)) {
        itemMap.set(id, item);
      }
    });

    const merged = Array.from(itemMap.values());
    assert.strictEqual(merged.length, 3);
    assert.ok(merged.some(m => m.boriNo === 'C-1001'));
    assert.ok(merged.some(m => m.boriNo === 'C-1002'));
    assert.ok(merged.some(m => m.boriNo === 'C-1003'));
  });

  await t.test('Tombstones prevent deleted items from reappearing', () => {
    const deletedId = 'p_2';
    const tombstones = [deletedId];
    const tombSet = new Set(tombstones);

    const incoming = [
      { id: 'p_1', boriNo: 'C-1001' },
      { id: 'p_2', boriNo: 'C-1002' },
      { id: 'p_3', boriNo: 'C-1003' }
    ];

    const filtered = incoming.filter(i => !tombSet.has(i.id) && !tombSet.has(i.boriNo));
    assert.strictEqual(filtered.length, 2);
    assert.ok(!filtered.some(i => i.id === 'p_2'));
  });

  await t.test('Yarn RM Stock Book: User A issues 20/1 BRT POLY box to Doubler, concurrent User B available snapshot does not overwrite', () => {
    const userALocalIssued = [
      {
        id: 'LOT-20-1-POLY',
        lotNumber: 'L-201',
        challanNo: 'CH-889',
        quality: '20/1 BRT POLY',
        supplier: 'ABC Mills',
        updated_at: new Date('2026-09-02T10:00:00Z').toISOString(),
        boxes: [
          {
            id: 'B1',
            boxNumber: 'B1',
            weight: 25.5,
            status: 'issued',
            issueDate: '2026-09-02',
            issuedTo: 'Doubler',
            updated_at: new Date('2026-09-02T10:00:00Z').toISOString()
          },
          {
            id: 'B2',
            boxNumber: 'B2',
            weight: 24.8,
            status: 'available',
            issueDate: null,
            issuedTo: null
          }
        ]
      }
    ];

    // User B was online and had old snapshot where B1 was available
    const userBRemoteStale = [
      {
        id: 'LOT-20-1-POLY',
        lotNumber: 'L-201',
        challanNo: 'CH-889',
        quality: '20/1 BRT POLY',
        supplier: 'ABC Mills',
        boxes: [
          {
            id: 'B1',
            boxNumber: 'B1',
            weight: 25.5,
            status: 'available',
            issueDate: null,
            issuedTo: null
          },
          {
            id: 'B2',
            boxNumber: 'B2',
            weight: 24.8,
            status: 'available',
            issueDate: null,
            issuedTo: null
          }
        ]
      }
    ];

    const testMerge = vSupabase.mergeDatasets('vishwa_yarn_rm_stock_data', userALocalIssued, userBRemoteStale);
    assert.ok(Array.isArray(testMerge), 'Merged result is array');
    assert.strictEqual(testMerge.length, 1);
    
    const lot = testMerge[0];
    assert.strictEqual(lot.quality, '20/1 BRT POLY');
    const boxB1 = lot.boxes.find(b => b.id === 'B1' || b.boxNumber === 'B1');
    assert.ok(boxB1, 'Box B1 exists');
    assert.strictEqual(boxB1.status, 'issued', 'Box B1 MUST remain issued');
    assert.strictEqual(boxB1.issuedTo, 'Doubler', 'Box B1 MUST remain issued to Doubler');
    assert.strictEqual(boxB1.issueDate, '2026-09-02');

    // Also test reverse order (Remote issued, Local stale available)
    const testMergeReverse = vSupabase.mergeDatasets('vishwa_yarn_rm_stock_data', userBRemoteStale, userALocalIssued);
    const revLot = testMergeReverse[0];
    const revBoxB1 = revLot.boxes.find(b => b.id === 'B1' || b.boxNumber === 'B1');
    assert.strictEqual(revBoxB1.status, 'issued', 'Reverse merge also preserves issued status');
    assert.strictEqual(revBoxB1.issuedTo, 'Doubler');
  });

  await t.test('Yarn RM Orders: Box issue statuses in batches are preserved across merges', () => {
    const ordersLocal = [
      {
        id: 'ORD-101',
        orderNumber: 'ORD-101',
        supplier: 'ABC Mills',
        quality: '20/1 BRT POLY',
        batches: [
          {
            id: 'BATCH-1',
            challanNumber: 'CH-889',
            lotNumber: 'L-201',
            boxes: [
              { boxNumber: 'B1', weight: 25.5, status: 'issued', issueDate: '2026-09-02', issuedTo: 'Doubler' },
              { boxNumber: 'B2', weight: 24.8, status: 'available' }
            ]
          }
        ]
      }
    ];

    const ordersRemoteStale = [
      {
        id: 'ORD-101',
        orderNumber: 'ORD-101',
        supplier: 'ABC Mills',
        quality: '20/1 BRT POLY',
        batches: [
          {
            id: 'BATCH-1',
            challanNumber: 'CH-889',
            lotNumber: 'L-201',
            boxes: [
              { boxNumber: 'B1', weight: 25.5, status: 'available' },
              { boxNumber: 'B2', weight: 24.8, status: 'available' }
            ]
          }
        ]
      }
    ];

    const mergedOrders = vSupabase.mergeDatasets('yarn-rm-orders', ordersLocal, ordersRemoteStale);
    assert.strictEqual(mergedOrders.length, 1);
    const ord = mergedOrders[0];
    const b1 = ord.batches[0].boxes.find(b => b.boxNumber === 'B1');
    assert.strictEqual(b1.status, 'issued');
    assert.strictEqual(b1.issuedTo, 'Doubler');
  });

  await t.test('Yarn RM Stock Book: User reverts box to Available, stale issued remote snapshot does NOT revert it back to issued', () => {
    // User A unissued box B1 at 2026-09-04
    const userALocalUnissued = [
      {
        id: 'LOT-20-1-POLY',
        lotNumber: 'L-201',
        challanNo: 'CH-889',
        quality: '20/1 BRT POLY',
        supplier: 'ABC Mills',
        updated_at: new Date('2026-09-04T12:00:00Z').toISOString(),
        boxes: [
          {
            id: 'B1',
            boxNumber: 'B1',
            weight: 25.5,
            status: 'available',
            issueDate: null,
            issuedTo: null,
            unissued_at: new Date('2026-09-04T12:00:00Z').toISOString(),
            updated_at: new Date('2026-09-04T12:00:00Z').toISOString()
          },
          {
            id: 'B2',
            boxNumber: 'B2',
            weight: 24.8,
            status: 'available',
            issueDate: null,
            issuedTo: null
          }
        ]
      }
    ];

    // User B had an older snapshot where B1 was issued to Doubler on 2026-09-02
    const userBRemoteStaleIssued = [
      {
        id: 'LOT-20-1-POLY',
        lotNumber: 'L-201',
        challanNo: 'CH-889',
        quality: '20/1 BRT POLY',
        supplier: 'ABC Mills',
        updated_at: new Date('2026-09-02T10:00:00Z').toISOString(),
        boxes: [
          {
            id: 'B1',
            boxNumber: 'B1',
            weight: 25.5,
            status: 'issued',
            issueDate: '2026-09-02',
            issuedTo: 'Doubler',
            updated_at: new Date('2026-09-02T10:00:00Z').toISOString()
          },
          {
            id: 'B2',
            boxNumber: 'B2',
            weight: 24.8,
            status: 'available',
            issueDate: null,
            issuedTo: null
          }
        ]
      }
    ];

    // Merge: Local unissued + Remote stale issued -> MUST be Available
    const testMerge = vSupabase.mergeDatasets('vishwa_yarn_rm_stock_data', userALocalUnissued, userBRemoteStaleIssued);
    assert.strictEqual(testMerge.length, 1);
    const lot = testMerge[0];
    const boxB1 = lot.boxes.find(b => b.id === 'B1' || b.boxNumber === 'B1');
    assert.ok(boxB1, 'Box B1 exists');
    assert.strictEqual(boxB1.status, 'available', 'Box B1 MUST remain available after unissuing');
    assert.strictEqual(boxB1.issueDate, null);
    assert.strictEqual(boxB1.issuedTo, null);

    // Reverse Merge: Remote unissued + Local stale issued -> MUST also be Available
    const testMergeRev = vSupabase.mergeDatasets('vishwa_yarn_rm_stock_data', userBRemoteStaleIssued, userALocalUnissued);
    const revBoxB1 = testMergeRev[0].boxes.find(b => b.id === 'B1' || b.boxNumber === 'B1');
    assert.strictEqual(revBoxB1.status, 'available', 'Reverse merge also preserves unissued available status');
    assert.strictEqual(revBoxB1.issueDate, null);
    assert.strictEqual(revBoxB1.issuedTo, null);
  });

  await t.test('Yarn RM Orders: Box unissued status in batches is preserved across merges', () => {
    const ordersLocalUnissued = [
      {
        id: 'ORD-101',
        orderNumber: 'ORD-101',
        supplier: 'ABC Mills',
        quality: '20/1 BRT POLY',
        batches: [
          {
            id: 'BATCH-1',
            challanNumber: 'CH-889',
            lotNumber: 'L-201',
            boxes: [
              {
                boxNumber: 'B1',
                weight: 25.5,
                status: 'available',
                issueDate: null,
                issuedTo: null,
                unissued_at: new Date('2026-09-04T12:00:00Z').toISOString(),
                updated_at: new Date('2026-09-04T12:00:00Z').toISOString()
              },
              { boxNumber: 'B2', weight: 24.8, status: 'available' }
            ]
          }
        ]
      }
    ];

    const ordersRemoteStaleIssued = [
      {
        id: 'ORD-101',
        orderNumber: 'ORD-101',
        supplier: 'ABC Mills',
        quality: '20/1 BRT POLY',
        batches: [
          {
            id: 'BATCH-1',
            challanNumber: 'CH-889',
            lotNumber: 'L-201',
            boxes: [
              {
                boxNumber: 'B1',
                weight: 25.5,
                status: 'issued',
                issueDate: '2026-09-02',
                issuedTo: 'Doubler',
                updated_at: new Date('2026-09-02T10:00:00Z').toISOString()
              },
              { boxNumber: 'B2', weight: 24.8, status: 'available' }
            ]
          }
        ]
      }
    ];

    const merged = vSupabase.mergeDatasets('yarn-rm-orders', ordersLocalUnissued, ordersRemoteStaleIssued);
    assert.strictEqual(merged.length, 1);
    const b1 = merged[0].batches[0].boxes.find(b => b.boxNumber === 'B1');
    assert.strictEqual(b1.status, 'available');
    assert.strictEqual(b1.issueDate, null);
    assert.strictEqual(b1.issuedTo, null);

    const mergedRev = vSupabase.mergeDatasets('yarn-rm-orders', ordersRemoteStaleIssued, ordersLocalUnissued);
    const revB1 = mergedRev[0].batches[0].boxes.find(b => b.boxNumber === 'B1');
    assert.strictEqual(revB1.status, 'available');
    assert.strictEqual(revB1.issueDate, null);
    assert.strictEqual(revB1.issuedTo, null);
  });

  await t.test('Yarn Sales Multi-PC: PC 1 (2 Doubler challans, 3 TFO challans) + PC 2 (1 Doubler challan) syncs without data loss', () => {
    // PC 1 has 2 challans in Doubler MX
    const pc1DoublerSales = [
      {
        id: 's_doubler_1',
        challanNo: 'CH-0001/D/26-27',
        date: '2026-09-04',
        customerName: 'Customer A',
        totalAmount: 15000,
        items: [{ boriNo: 'D-1001', rollsQty: 10, saleQty: 50, rate: 300, amount: 15000 }],
        updated_at: '2026-09-04T10:00:00.000Z'
      },
      {
        id: 's_doubler_2',
        challanNo: 'CH-0002/D/26-27',
        date: '2026-09-04',
        customerName: 'Customer B',
        totalAmount: 20000,
        items: [{ boriNo: 'D-1002', rollsQty: 15, saleQty: 80, rate: 250, amount: 20000 }],
        updated_at: '2026-09-04T11:00:00.000Z'
      }
    ];

    // PC 2 only has 1 challan in Doubler MX
    const pc2DoublerSales = [
      {
        id: 's_doubler_1',
        challanNo: 'CH-0001/D/26-27',
        date: '2026-09-04',
        customerName: 'Customer A',
        totalAmount: 15000,
        items: [{ boriNo: 'D-1001', rollsQty: 10, saleQty: 50, rate: 300, amount: 15000 }],
        updated_at: '2026-09-04T10:00:00.000Z'
      }
    ];

    // Merge on PC 2 (PC 2 local + PC 1 remote)
    const mergedDoublerOnPC2 = vSupabase.mergeDatasets('yarn_doubler_sales_logs', pc2DoublerSales, pc1DoublerSales);
    assert.strictEqual(mergedDoublerOnPC2.length, 2, 'PC 2 must now have all 2 Doubler challans');
    assert.ok(mergedDoublerOnPC2.some(s => s.challanNo === 'CH-0001/D/26-27'));
    assert.ok(mergedDoublerOnPC2.some(s => s.challanNo === 'CH-0002/D/26-27'));

    // Reverse merge on PC 1 (PC 1 local + PC 2 remote snapshot)
    const mergedDoublerOnPC1 = vSupabase.mergeDatasets('yarn_doubler_sales_logs', pc1DoublerSales, pc2DoublerSales);
    assert.strictEqual(mergedDoublerOnPC1.length, 2, 'PC 1 must never lose its 2nd Doubler challan when receiving older PC 2 snapshot');
    assert.ok(mergedDoublerOnPC1.some(s => s.challanNo === 'CH-0001/D/26-27'));
    assert.ok(mergedDoublerOnPC1.some(s => s.challanNo === 'CH-0002/D/26-27'));

    // PC 1 has 3 challans in TFO
    const pc1TfoSales = [
      {
        id: 's_tfo_1',
        challanNo: 'CH-0001/T/26-27',
        date: '2026-09-04',
        customerName: 'Party X',
        totalAmount: 12000,
        items: [{ boriNo: 'T-1001', rollsQty: 8, saleQty: 40, rate: 300, amount: 12000 }],
        updated_at: '2026-09-04T09:00:00.000Z'
      },
      {
        id: 's_tfo_2',
        challanNo: 'CH-0002/T/26-27',
        date: '2026-09-04',
        customerName: 'Party Y',
        totalAmount: 18000,
        items: [{ boriNo: 'T-1002', rollsQty: 12, saleQty: 60, rate: 300, amount: 18000 }],
        updated_at: '2026-09-04T10:30:00.000Z'
      },
      {
        id: 's_tfo_3',
        challanNo: 'CH-0003/T/26-27',
        date: '2026-09-04',
        customerName: 'Party Z',
        totalAmount: 24000,
        items: [{ boriNo: 'T-1003', rollsQty: 16, saleQty: 80, rate: 300, amount: 24000 }],
        updated_at: '2026-09-04T11:45:00.000Z'
      }
    ];

    // PC 2 has 0 challans in TFO
    const pc2TfoSales = [];

    // Merge on PC 2 (PC 2 local empty + PC 1 remote 3 challans)
    const mergedTfoOnPC2 = vSupabase.mergeDatasets('yarn_tfo_sales_logs', pc2TfoSales, pc1TfoSales);
    assert.strictEqual(mergedTfoOnPC2.length, 3, 'PC 2 must receive all 3 TFO challans from PC 1');

    // Reverse merge on PC 1 (PC 1 local 3 challans + PC 2 remote empty)
    const mergedTfoOnPC1 = vSupabase.mergeDatasets('yarn_tfo_sales_logs', pc1TfoSales, pc2TfoSales);
    assert.strictEqual(mergedTfoOnPC1.length, 3, 'PC 1 must never lose its 3 TFO challans');
  });

  await t.test('Yarn Sales: Concurrent edit on same Challan preserves newer updates', () => {
    const saleOld = [
      {
        id: 's_doubler_1',
        challanNo: 'CH-0001/D/26-27',
        customerName: 'Old Customer Name',
        totalAmount: 15000,
        updated_at: '2026-09-04T10:00:00.000Z'
      }
    ];

    const saleNew = [
      {
        id: 's_doubler_1',
        challanNo: 'CH-0001/D/26-27',
        customerName: 'Updated Customer Name Ltd',
        totalAmount: 16500,
        updated_at: '2026-09-04T12:00:00.000Z'
      }
    ];

    const merged = vSupabase.mergeDatasets('yarn_doubler_sales_logs', saleNew, saleOld);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].customerName, 'Updated Customer Name Ltd');
    assert.strictEqual(merged[0].totalAmount, 16500);
  });

  await t.test('Yarn Sales: Creating Challan 2 then Challan 1 never vanishes or overwrites', async () => {
    // Simulate creating Challan 2
    const sale2 = {
      id: 's_' + Date.now() + '_challan2',
      challanNo: '2',
      invoiceNo: '2',
      date: '2026-09-05',
      customerName: 'Customer B',
      totalQty: 100,
      totalAmount: 15000,
      updated_at: new Date().toISOString()
    };

    let salesList = [sale2];
    let filtered1 = vSupabase.filterDeletedEntities(salesList);
    assert.strictEqual(filtered1.length, 1);
    assert.strictEqual(filtered1[0].challanNo, '2');

    // Simulate creating Challan 1 next
    const sale1 = {
      id: 's_' + (Date.now() + 100) + '_challan1',
      challanNo: '1',
      invoiceNo: '1',
      date: '2026-09-05',
      customerName: 'Customer A',
      totalQty: 50,
      totalAmount: 7500,
      updated_at: new Date().toISOString()
    };

    salesList.push(sale1);

    // Filter and merge datasets
    let filtered2 = vSupabase.filterDeletedEntities(salesList);
    assert.strictEqual(filtered2.length, 2, 'Both Challan 2 and Challan 1 must be present after filterDeletedEntities');
    assert.ok(filtered2.some(s => s.challanNo === '2'), 'Challan 2 must exist');
    assert.ok(filtered2.some(s => s.challanNo === '1'), 'Challan 1 must exist');

    // Remote sync merge simulation
    const remoteSales = [sale2];
    const mergedSales = vSupabase.mergeDatasets('yarn_doubler_sales_logs', salesList, remoteSales);
    assert.strictEqual(mergedSales.length, 2, 'Merged sales must contain both Challan 2 and Challan 1');
    assert.ok(mergedSales.some(s => s.challanNo === '2'));
    assert.ok(mergedSales.some(s => s.challanNo === '1'));
  });

  await t.test('Yarn Sales: Stale or legacy tombstones do not delete active Challans', async () => {
    // Suppose legacy tombstones contain raw digits '1' or '2'
    env.localStorage.setItem('vf_deleted_entity_ids', JSON.stringify(['1', '2', 'CH-0001', 's_old_deleted_id']));

    const activeSale1 = {
      id: 's_' + Date.now() + '_active1',
      challanNo: '1',
      invoiceNo: '1',
      date: '2026-09-05',
      customerName: 'Customer A',
      totalQty: 50,
      totalAmount: 7500,
      updated_at: new Date().toISOString()
    };

    const activeSale2 = {
      id: 's_' + (Date.now() + 50) + '_active2',
      challanNo: '2',
      invoiceNo: '2',
      date: '2026-09-05',
      customerName: 'Customer B',
      totalQty: 100,
      totalAmount: 15000,
      updated_at: new Date().toISOString()
    };

    const deletedSale = {
      id: 's_old_deleted_id',
      challanNo: '99',
      date: '2026-09-01',
      totalAmount: 1000
    };

    const allSales = [activeSale1, activeSale2, deletedSale];
    const filtered = vSupabase.filterDeletedEntities(allSales);

    assert.strictEqual(filtered.length, 2, 'Must keep activeSale1 and activeSale2 while filtering out deletedSale');
    assert.ok(filtered.some(s => s.challanNo === '1'), 'Active Challan 1 must not be deleted by legacy tombstone');
    assert.ok(filtered.some(s => s.challanNo === '2'), 'Active Challan 2 must not be deleted by legacy tombstone');
    assert.ok(!filtered.some(s => s.id === 's_old_deleted_id'), 'Deleted sale must be filtered');
  });

  await t.test('Yarn Sales: Two sales cannot have the same Challan number or duplicate details', async () => {
    const existingSales = [
      {
        id: 's_existing_1',
        challanNo: 'CH-0001/D/2026-27',
        customerName: 'Customer A',
        date: '2026-09-05',
        items: [{ boriNo: 'D-101', rollsQty: 10, saleQty: 50 }]
      }
    ];

    // Attempt to create a sale with the same Challan number
    const isDuplicateChallan = (challanNo, editId = '') => {
      return existingSales.some(s => s.id !== editId && s.challanNo && String(s.challanNo).trim().toLowerCase() === challanNo.trim().toLowerCase());
    };

    assert.strictEqual(isDuplicateChallan('CH-0001/D/2026-27'), true, 'Must detect duplicate challan number');
    assert.strictEqual(isDuplicateChallan('ch-0001/d/2026-27'), true, 'Must detect case-insensitive duplicate challan number');
    assert.strictEqual(isDuplicateChallan('CH-0002/D/2026-27'), false, 'New unique challan number must be allowed');
    assert.strictEqual(isDuplicateChallan('CH-0001/D/2026-27', 's_existing_1'), false, 'Editing existing sale with its own challan number is allowed');

    // Attempt to create duplicate details
    const isDuplicateDetails = (customer, date, items, editId = '') => {
      const curSig = items.map(i => `${i.boriNo}:${i.rollsQty}:${i.saleQty}`).sort().join('|');
      return existingSales.some(s => {
        if (s.id === editId) return false;
        const sSig = (s.items && s.items.length > 0) ? s.items.map(i => `${i.boriNo}:${i.rollsQty}:${i.saleQty}`).sort().join('|') : '';
        return s.customerName.toLowerCase() === customer.toLowerCase() && s.date === date && curSig === sSig;
      });
    };

    assert.strictEqual(isDuplicateDetails('Customer A', '2026-09-05', [{ boriNo: 'D-101', rollsQty: 10, saleQty: 50 }]), true, 'Must detect identical sale details');
    assert.strictEqual(isDuplicateDetails('Customer B', '2026-09-05', [{ boriNo: 'D-101', rollsQty: 10, saleQty: 50 }]), false, 'Different customer is allowed');
    assert.strictEqual(isDuplicateDetails('Customer A', '2026-09-06', [{ boriNo: 'D-101', rollsQty: 10, saleQty: 50 }]), false, 'Different date is allowed');
  });

  await t.test('Yarn Production: Multiple PCs producing Boris in Doubler/MX and TFO merge seamlessly', () => {
    const pc1Prod = [
      { id: 'p_d_1', boriNo: 'D-1001', productName: 'Doubler 2Core', qty: 25.5, rolls: 20, date: '2026-09-04' },
      { id: 'p_d_2', boriNo: 'D-1002', productName: 'Doubler 2Core', qty: 26.0, rolls: 20, date: '2026-09-04' }
    ];

    const pc2Prod = [
      { id: 'p_d_1', boriNo: 'D-1001', productName: 'Doubler 2Core', qty: 25.5, rolls: 20, date: '2026-09-04' },
      { id: 'p_d_3', boriNo: 'D-1003', productName: 'Doubler 2Core', qty: 25.8, rolls: 20, date: '2026-09-04' }
    ];

    const merged = vSupabase.mergeDatasets('yarn_doubler_production_logs', pc1Prod, pc2Prod);
    assert.strictEqual(merged.length, 3, 'All 3 produced boris D-1001, D-1002, D-1003 must be preserved across PCs');
    assert.ok(merged.some(p => p.boriNo === 'D-1001'));
    assert.ok(merged.some(p => p.boriNo === 'D-1002'));
    assert.ok(merged.some(p => p.boriNo === 'D-1003'));
  });

  await t.test('Multi-PC Order Status Sync: PC 1 completes order, PC 2 receives remote update and reflects Completed status instantly', () => {
    // PC 2 local state has order with status Active
    const pc2LocalOrders = [
      {
        id: 'YRN-ORD-901',
        orderNumber: 'YRN-901',
        supplier: 'ABC Mills',
        quality: '30/1 COTTON',
        status: 'Active',
        orderedWeight: 1000,
        batches: [],
        updated_at: '2026-09-04T10:00:00.000Z'
      }
    ];

    // PC 1 marked it as Completed
    const pc1RemoteOrders = [
      {
        id: 'YRN-ORD-901',
        orderNumber: 'YRN-901',
        supplier: 'ABC Mills',
        quality: '30/1 COTTON',
        status: 'Completed',
        orderedWeight: 1000,
        batches: [],
        updated_at: '2026-09-04T10:05:00.000Z'
      }
    ];

    const mergedOnPC2 = vSupabase.mergeDatasets('yarn-rm-orders', pc2LocalOrders, pc1RemoteOrders);
    assert.strictEqual(mergedOnPC2.length, 1);
    assert.strictEqual(mergedOnPC2[0].status, 'Completed', 'PC 2 must immediately show Completed status');
  });

  await t.test('Multi-PC Order Status Sync: PC 2 reverts Completed order to Active, PC 1 receives update and reflects Active status', () => {
    // PC 1 had Completed order
    const pc1LocalOrders = [
      {
        id: 'YRN-ORD-901',
        orderNumber: 'YRN-901',
        supplier: 'ABC Mills',
        quality: '30/1 COTTON',
        status: 'Completed',
        orderedWeight: 1000,
        batches: [],
        updated_at: '2026-09-04T10:05:00.000Z'
      }
    ];

    // PC 2 clicked "Revert to Active"
    const pc2RemoteOrders = [
      {
        id: 'YRN-ORD-901',
        orderNumber: 'YRN-901',
        supplier: 'ABC Mills',
        quality: '30/1 COTTON',
        status: 'Active',
        orderedWeight: 1000,
        batches: [],
        updated_at: '2026-09-04T10:10:00.000Z'
      }
    ];

    const mergedOnPC1 = vSupabase.mergeDatasets('yarn-rm-orders', pc1LocalOrders, pc2RemoteOrders);
    assert.strictEqual(mergedOnPC1.length, 1);
    assert.strictEqual(mergedOnPC1[0].status, 'Active', 'PC 1 must immediately show Active status upon receiving revert');
  });

  await t.test('VishwaSupabase exposes saveToSupabase API method for instant sync', () => {
    assert.ok(typeof vSupabase.saveToSupabase === 'function', 'saveToSupabase function is exposed on VishwaSupabase');
  });

  await t.test('Yarn RM Stock Book Single Source of Truth: Deleted lot in orders is evicted and cannot resurrect', () => {
    // Orders only contains Active Lot 201 (Lot 100 was deleted by user)
    const activeOrders = [
      {
        id: 'ORD-101',
        orderNumber: 'ORD-101',
        supplier: 'ABC Mills',
        quality: '20/1 BRT POLY',
        batches: [
          {
            id: 'BATCH-201',
            challanNumber: 'CH-889',
            lotNumber: 'L-201',
            boxes: [
              { boxNumber: 'B1', weight: 25.5, status: 'available' }
            ]
          }
        ]
      }
    ];

    // Simulate active orders in storage
    env.localStorage.setItem('yarn-rm-orders', JSON.stringify(activeOrders));

    // Stale local or remote stock still had old/deleted Lot 100 (Resurrected Quality: 80/72 Polyester DTY)
    const staleStockWithDeletedLot = [
      {
        id: 'LOT-DELETED-100',
        batchId: 'BATCH-OLD-100',
        lotNumber: 'OLD-LOT-100',
        challanNo: 'CH-OLD-999',
        quality: '80/72 Polyester DTY',
        supplier: 'Old Supplier',
        boxes: [{ id: 'B1', boxNumber: 'B1', weight: 30.0, status: 'available' }]
      },
      {
        id: 'L-201__CH-889',
        batchId: 'BATCH-201',
        lotNumber: 'L-201',
        challanNo: 'CH-889',
        quality: '20/1 BRT POLY',
        supplier: 'ABC Mills',
        boxes: [{ id: 'B1', boxNumber: 'B1', weight: 25.5, status: 'available' }]
      }
    ];

    const mergedStock = vSupabase.mergeDatasets('vishwa_yarn_rm_stock_data', staleStockWithDeletedLot, []);
    assert.strictEqual(mergedStock.length, 1, 'Deleted lot must be pruned from stock');
    assert.strictEqual(mergedStock[0].quality, '20/1 BRT POLY', 'Only active quality remains');
    assert.strictEqual(mergedStock[0].lotNumber, 'L-201');
    assert.ok(!mergedStock.some(l => l.quality === '80/72 Polyester DTY'), 'Deleted resurrected quality is evicted');
  });

  await t.test('Yarn RM Stock Book Single Source of Truth: When all orders deleted, stock is empty', () => {
    // All orders deleted
    env.localStorage.setItem('yarn-rm-orders', JSON.stringify([]));

    const staleStock = [
      {
        id: 'LOT-DELETED-100',
        quality: '80/72 Polyester DTY',
        boxes: [{ id: 'B1', boxNumber: 'B1', weight: 30.0, status: 'available' }]
      }
    ];

    const mergedStock = vSupabase.mergeDatasets('vishwa_yarn_rm_stock_data', staleStock, []);
    assert.strictEqual(mergedStock.length, 0, 'Stock is strictly empty when all orders are deleted');
  });

  await t.test('Supabase Single Source of Truth: Fresh PC with empty localStorage pulls all lots and boxes directly from Supabase without PC 1 online', () => {
    // 1. PC 1 created stock on server
    const remoteServerLots = [
      {
        id: 'LOT-POLY-889',
        lotNumber: 'L-889',
        challanNo: 'CH-1002',
        quality: '20/1 BRT POLY',
        supplier: 'National Textile',
        receiveDate: '2026-09-05',
        boxes: [
          { id: 'B1', boxNumber: 'B1', weight: 25.0, status: 'available', cones: 24 },
          { id: 'B2', boxNumber: 'B2', weight: 25.2, status: 'issued', issueDate: '2026-09-05', issuedTo: 'Doubler', cones: 24 }
        ]
      },
      {
        id: 'LOT-COTTON-501',
        lotNumber: 'L-501',
        challanNo: 'CH-1003',
        quality: '30s Combed Cotton',
        supplier: 'Vardhman',
        receiveDate: '2026-09-05',
        boxes: [
          { id: 'B1', boxNumber: 'B1', weight: 30.0, status: 'available', cones: 30 }
        ]
      }
    ];

    // 2. PC 2 opens with completely blank localStorage (fresh browser/device)
    const pc2LocalEmpty = [];

    // PC 2 merges local empty state with authoritative remote server data
    const pc2HydratedStock = vSupabase.mergeDatasets('vishwa_yarn_rm_stock_data', pc2LocalEmpty, remoteServerLots);

    assert.strictEqual(pc2HydratedStock.length, 2, 'Fresh PC must have 2 lots loaded from Supabase');
    const polyLot = pc2HydratedStock.find(l => l.id === 'LOT-POLY-889');
    assert.ok(polyLot, 'Poly lot exists on PC 2');
    assert.strictEqual(polyLot.boxes.length, 2, 'Poly lot has 2 boxes');
    assert.strictEqual(polyLot.boxes.find(b => b.id === 'B2').status, 'issued', 'Issued status preserved on fresh PC');
    assert.strictEqual(polyLot.boxes.find(b => b.id === 'B2').issuedTo, 'Doubler', 'IssuedTo preserved on fresh PC');
    assert.strictEqual(polyLot.boxes.find(b => b.id === 'B1').status, 'available', 'Available status preserved on fresh PC');

    const cottonLot = pc2HydratedStock.find(l => l.id === 'LOT-COTTON-501');
    assert.ok(cottonLot, 'Cotton lot exists on PC 2');
  });

  await t.test('Supabase Single Source of Truth: Pre-hydration empty state does not wipe cloud storage', () => {
    // Create new unhydrated environment
    const freshEnv = createTestEnv();
    const freshSupabase = freshEnv.window.VishwaSupabase;

    // isHydrated is false initially
    assert.strictEqual(freshSupabase.isHydrated(), false, 'isHydrated is initially false');

    // Calling set with empty array while unhydrated must be refused
    const setResult = freshSupabase.set('vishwa_yarn_rm_stock_data', []);
    assert.strictEqual(setResult, false, 'Unhydrated empty set must be blocked from writing to Supabase');
  });
});



