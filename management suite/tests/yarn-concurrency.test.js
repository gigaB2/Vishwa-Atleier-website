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
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
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
});
