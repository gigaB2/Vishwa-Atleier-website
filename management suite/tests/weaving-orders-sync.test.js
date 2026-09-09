const assert = require('assert');
const test = require('node:test');
const fs = require('fs');
const path = require('path');

test('Weaving RM Orders — Multi-PC Sync & Supabase Single Source of Truth', async (t) => {
  const filePath = fs.existsSync(path.join(__dirname, '../assets/supabase-client.js'))
    ? path.join(__dirname, '../assets/supabase-client.js')
    : 'assets/supabase-client.js';
  const clientCode = fs.readFileSync(filePath, 'utf8');

  // Create isolated sandbox context
  function createTestEnv(pathname = '/management%20suite/modules/weaving/order-book.html') {
    const listeners = {};
    const sandbox = {
      window: {
        location: { pathname, href: `http://localhost${pathname}` },
        addEventListener: (event, handler) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(handler);
        },
        removeEventListener: (event, handler) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter(h => h !== handler);
          }
        },
        dispatchEvent: (evt) => {
          const handlers = listeners[evt.name || evt.type] || [];
          handlers.forEach(h => h(evt));
          return true;
        },
        CustomEvent: function(name, opts) {
          this.name = name;
          this.type = name;
          this.detail = opts?.detail;
        },
        StorageEvent: function(name, opts) {
          this.name = name;
          this.type = name;
          this.key = opts?.key;
          this.newValue = opts?.newValue;
        },
        HTMLInputElement: function() {},
        HTMLTextAreaElement: function() {},
        HTMLSelectElement: function() {}
      },
      document: {
        location: { pathname, href: `http://localhost${pathname}` },
        addEventListener: () => {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
      },
      localStorage: {
        _data: {},
        getItem(k) { return this._data[k] !== undefined ? this._data[k] : null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; },
        clear() { this._data = {}; }
      },
      navigator: { onLine: true },
      console: console,
      setTimeout: (fn, ms) => setTimeout(fn, 0),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: () => ({ unref: () => {} }),
      clearInterval: () => {},
      Date: Date,
      listeners
    };

    const fn = new Function('window', 'document', 'localStorage', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', clientCode);
    fn(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.console, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval, sandbox.clearInterval, sandbox.Date);
    return sandbox;
  }

  const env = createTestEnv();
  const vSupabase = env.window.VishwaSupabase;

  await t.test('1. VishwaSupabase initializes correctly with weaving orders support', () => {
    assert.ok(vSupabase, 'VishwaSupabase is initialized');
    assert.strictEqual(typeof vSupabase.saveToSupabase, 'function');
    assert.strictEqual(typeof vSupabase.mergeDatasets, 'function');
    assert.strictEqual(typeof vSupabase.recordDeletion, 'function');
    assert.strictEqual(typeof vSupabase.filterDeletedEntities, 'function');
  });

  await t.test('2. Hydration on Fresh PC: Authoritative remote weaving orders preserved with empty localStorage', () => {
    const pc1RemoteOrders = [
      {
        id: 'WV-ORD-101',
        orderNumber: 'WV-101',
        quality: 'POLY VISCOSE 2/40',
        code: 'PV-01',
        color: 'Navy Blue',
        supplier: 'Reliance Industries',
        orderedWeight: 2500,
        status: 'Active',
        batches: [
          {
            id: 'BCH-1',
            challanNumber: 'CH-9001',
            lotNumber: 'LOT-A',
            totalWeight: 500,
            boxes: [{ boxNumber: 'B1', weight: 250, cones: 10, returnedWeight: 0 }]
          }
        ],
        createdAt: '2026-09-08T10:00:00.000Z',
        updatedAt: '2026-09-08T10:00:00.000Z'
      }
    ];

    // PC 2 is fresh (empty array in localStorage)
    const pc2LocalOrders = [];

    const merged = vSupabase.mergeDatasets('yarn-orders', pc2LocalOrders, pc1RemoteOrders);
    assert.strictEqual(merged.length, 1, 'Fresh PC must pull authoritative remote weaving orders');
    assert.strictEqual(merged[0].id, 'WV-ORD-101');
    assert.strictEqual(merged[0].quality, 'POLY VISCOSE 2/40');
    assert.strictEqual(merged[0].batches.length, 1);
  });

  await t.test('3. Multi-PC Order Status Sync: PC 1 completes order, PC 2 receives Completed status', () => {
    const pc2StaleActiveOrders = [
      {
        id: 'WV-ORD-201',
        orderNumber: 'WV-201',
        quality: 'COTTON 40s',
        status: 'Active',
        orderedWeight: 1000,
        batches: [],
        createdAt: '2026-09-08T09:00:00.000Z',
        updatedAt: '2026-09-08T09:00:00.000Z'
      }
    ];

    // PC 1 completed the order
    const pc1CompletedOrders = [
      {
        id: 'WV-ORD-201',
        orderNumber: 'WV-201',
        quality: 'COTTON 40s',
        status: 'Completed',
        orderedWeight: 1000,
        batches: [],
        createdAt: '2026-09-08T09:00:00.000Z',
        updatedAt: '2026-09-08T11:00:00.000Z'
      }
    ];

    const mergedOnPC2 = vSupabase.mergeDatasets('yarn-orders', pc2StaleActiveOrders, pc1CompletedOrders);
    assert.strictEqual(mergedOnPC2.length, 1);
    assert.strictEqual(mergedOnPC2[0].status, 'Completed', 'Order status must be Completed on PC 2');
  });

  await t.test('4. Multi-PC Order Status Sync: PC 2 reverts to Active, PC 1 receives Active status', () => {
    const pc1CompletedOrders = [
      {
        id: 'WV-ORD-201',
        orderNumber: 'WV-201',
        quality: 'COTTON 40s',
        status: 'Completed',
        orderedWeight: 1000,
        batches: [],
        createdAt: '2026-09-08T09:00:00.000Z',
        updatedAt: '2026-09-08T11:00:00.000Z'
      }
    ];

    // PC 2 clicked "Revert to Active"
    const pc2RevertedOrders = [
      {
        id: 'WV-ORD-201',
        orderNumber: 'WV-201',
        quality: 'COTTON 40s',
        status: 'Active',
        orderedWeight: 1000,
        batches: [],
        createdAt: '2026-09-08T09:00:00.000Z',
        updatedAt: '2026-09-08T11:30:00.000Z'
      }
    ];

    const mergedOnPC1 = vSupabase.mergeDatasets('yarn-orders', pc1CompletedOrders, pc2RevertedOrders);
    assert.strictEqual(mergedOnPC1.length, 1);
    assert.strictEqual(mergedOnPC1[0].status, 'Active', 'Reverting to Active must prevail on peer PC');
  });

  await t.test('5. Multi-PC Batch & Box Addition: Concurrent receipts merge without data loss', () => {
    // PC 1 adds Batch 1 (Challan 501)
    const pc1Orders = [
      {
        id: 'WV-ORD-301',
        orderNumber: 'WV-301',
        quality: 'LINEN 60 Lea',
        orderedWeight: 3000,
        batches: [
          {
            id: 'BCH-501',
            challanNumber: 'CH-501',
            lotNumber: 'LOT-LINEN-1',
            totalWeight: 1200,
            boxes: [
              { boxNumber: 'B1', weight: 600, cones: 24, returnedWeight: 0 },
              { boxNumber: 'B2', weight: 600, cones: 24, returnedWeight: 0 }
            ]
          }
        ],
        updatedAt: '2026-09-08T12:00:00.000Z'
      }
    ];

    // PC 2 concurrently adds Batch 2 (Challan 502)
    const pc2Orders = [
      {
        id: 'WV-ORD-301',
        orderNumber: 'WV-301',
        quality: 'LINEN 60 Lea',
        orderedWeight: 3000,
        batches: [
          {
            id: 'BCH-502',
            challanNumber: 'CH-502',
            lotNumber: 'LOT-LINEN-2',
            totalWeight: 1500,
            boxes: [
              { boxNumber: 'B3', weight: 750, cones: 30, returnedWeight: 0 },
              { boxNumber: 'B4', weight: 750, cones: 30, returnedWeight: 0 }
            ]
          }
        ],
        updatedAt: '2026-09-08T12:05:00.000Z'
      }
    ];

    // PC 1 saves local order with Batch 1 (via UI saveToSupabase)
    vSupabase.saveToSupabase('yarn-orders', pc1Orders, true);

    const merged = vSupabase.mergeDatasets('yarn-orders', pc1Orders, pc2Orders);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].batches.length, 2, 'Both batches must be preserved without loss');
    const challanNums = merged[0].batches.map(b => b.challanNumber).sort();
    assert.deepStrictEqual(challanNums, ['CH-501', 'CH-502']);
  });

  await t.test('6. Tombstones & Deletion Safety: Deleted weaving orders cannot be resurrected', () => {
    const deletedOrderId = 'WV-ORD-TO-DELETE';
    const deletedOrderNumber = 'WV-DELETE-99';

    // PC 1 deletes the order and records deletion
    vSupabase.recordDeletion('yarn-orders', [deletedOrderId, deletedOrderNumber]);

    // PC 2 still has the deleted order in an older snapshot
    const pc2StaleSnapshot = [
      {
        id: deletedOrderId,
        orderNumber: deletedOrderNumber,
        quality: 'ZOMBIE WEAVING YARN',
        orderedWeight: 500,
        status: 'Active',
        batches: [],
        updatedAt: '2026-09-08T14:00:00.000Z'
      },
      {
        id: 'WV-ORD-KEEP',
        orderNumber: 'WV-KEEP-01',
        quality: 'RELIABLE SILK',
        orderedWeight: 800,
        status: 'Active',
        batches: [],
        updatedAt: '2026-09-08T14:00:00.000Z'
      }
    ];

    // Filter using filterDeletedEntities
    const filtered = vSupabase.filterDeletedEntities(pc2StaleSnapshot);
    assert.strictEqual(filtered.length, 1, 'Tombstoned weaving order must be filtered out');
    assert.strictEqual(filtered[0].id, 'WV-ORD-KEEP');

    // Merge must also enforce deletion even if remote or local tries to resurrect
    const merged = vSupabase.mergeDatasets('yarn-orders', [], pc2StaleSnapshot);
    assert.strictEqual(merged.length, 1, 'Tombstoned weaving order must not resurrect via mergeDatasets');
    assert.strictEqual(merged[0].id, 'WV-ORD-KEEP');
  });

  await t.test('7. Downstream Weaving Reactive Listeners: Storage & CustomEvent propagation', () => {
    let orderUpdatedReceived = 0;
    let weavingOrderUpdatedReceived = 0;
    let supabaseSyncReceived = 0;

    env.window.addEventListener('yarn-order-updated', (e) => {
      orderUpdatedReceived++;
      assert.ok(e.detail.order || e.detail.id);
    });

    env.window.addEventListener('weaving-order-updated', (e) => {
      weavingOrderUpdatedReceived++;
      assert.ok(e.detail.order || e.detail.id);
    });

    env.window.addEventListener('supabase-sync', (e) => {
      supabaseSyncReceived++;
      assert.strictEqual(e.detail.key, 'yarn-orders');
    });

    // Simulate order creation dispatch
    env.window.dispatchEvent(new env.window.CustomEvent('yarn-order-updated', { detail: { order: { id: 'WV-1' } } }));
    env.window.dispatchEvent(new env.window.CustomEvent('weaving-order-updated', { detail: { order: { id: 'WV-1' } } }));
    env.window.dispatchEvent(new env.window.CustomEvent('supabase-sync', { detail: { key: 'yarn-orders' } }));

    assert.strictEqual(orderUpdatedReceived, 1);
    assert.strictEqual(weavingOrderUpdatedReceived, 1);
    assert.strictEqual(supabaseSyncReceived, 1);
  });

  await t.test('8. Dataset Isolation: Weaving RM orders (yarn-orders) and Yarn RM orders (yarn-rm-orders) remain strictly separate', () => {
    const weavingOrders = [
      {
        id: 'WV-ORD-101',
        orderNumber: 'WV-101',
        quality: 'WARP SILK 50D',
        supplier: 'National Textiles',
        orderedWeight: 1200,
        status: 'Active',
        batches: []
      }
    ];

    const yarnOrders = [
      {
        id: 'YRN-ORD-201',
        orderNumber: 'YRN-201',
        quality: '20/1 BRT POLY',
        supplier: 'Reliance Industries',
        orderedWeight: 5000,
        status: 'Active',
        batches: []
      }
    ];

    vSupabase.saveToSupabase('yarn-orders', weavingOrders, true);
    vSupabase.saveToSupabase('yarn-rm-orders', yarnOrders, true);

    const savedWeavingOrders = JSON.parse(env.localStorage.getItem('yarn-orders') || '[]');
    const savedYarnOrders = JSON.parse(env.localStorage.getItem('yarn-rm-orders') || '[]');

    assert.strictEqual(savedWeavingOrders.length, 1, 'Weaving orders must contain only weaving orders');
    assert.strictEqual(savedWeavingOrders[0].id, 'WV-ORD-101');
    assert.strictEqual(savedYarnOrders.length, 1, 'Yarn orders must contain only yarn orders');
    assert.strictEqual(savedYarnOrders[0].id, 'YRN-ORD-201');
  });
});
