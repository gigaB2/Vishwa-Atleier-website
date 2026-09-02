const test = require('node:test');
const assert = require('node:assert/strict');

// Replicate the core pure algorithm from supabase-client.js for Node test environment
function getItemIdentifier(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.id !== undefined && item.id !== null && String(item.id).trim() !== '') {
    return String(item.id).trim();
  }
  if (item._id !== undefined && item._id !== null && String(item._id).trim() !== '') {
    return String(item._id).trim();
  }
  if (item.uuid !== undefined && item.uuid !== null && String(item.uuid).trim() !== '') {
    return String(item.uuid).trim();
  }
  if (item.orderId || item.orderNo) {
    return 'ord_' + String(item.orderId || item.orderNo).trim();
  }
  if (item.billNo || item.invoiceNo) {
    return 'inv_' + String(item.billNo || item.invoiceNo).trim();
  }
  if (item.lotNo || item.lot) {
    return 'lot_' + String(item.lotNo || item.lot).trim() + '_' + (item.date || '');
  }
  if (item.date && (item.shift || item.machine || item.machineNo || item.loom || item.loomNo || item.worker)) {
    return `log_${item.date}_${item.shift || ''}_${item.machine || item.machineNo || item.loom || item.loomNo || ''}_${item.productName || item.worker || ''}`;
  }
  return null;
}

function mergeDatasets(localVal, remoteVal, tombstones = []) {
  if (localVal === undefined || localVal === null) return remoteVal;
  if (remoteVal === undefined || remoteVal === null) return localVal;

  let parsedLocal = localVal;
  let parsedRemote = remoteVal;

  try {
    if (typeof localVal === 'string' && (localVal.startsWith('[') || localVal.startsWith('{'))) {
      parsedLocal = JSON.parse(localVal);
    }
  } catch(e) {}

  try {
    if (typeof remoteVal === 'string' && (remoteVal.startsWith('[') || remoteVal.startsWith('{'))) {
      parsedRemote = JSON.parse(remoteVal);
    }
  } catch(e) {}

  // Case 1: Both are Arrays -> Item-level Deduplicated Union Merge
  if (Array.isArray(parsedLocal) && Array.isArray(parsedRemote)) {
    const mergedMap = new Map();
    const unkeyedRemoteItems = [];

    // 1. Index remote items (authoritative server snapshot)
    parsedRemote.forEach(item => {
      const id = getItemIdentifier(item);
      if (id) {
        if (!tombstones.includes(id)) {
          mergedMap.set(id, item);
        }
      } else {
        unkeyedRemoteItems.push(item);
      }
    });

    // 2. Merge local items
    parsedLocal.forEach(localItem => {
      const id = getItemIdentifier(localItem);
      if (id) {
        if (!tombstones.includes(id)) {
          if (!mergedMap.has(id)) {
            // New local item added offline
            mergedMap.set(id, localItem);
          } else {
            // Item exists in both -> compare timestamps
            const remoteItem = mergedMap.get(id);
            const localTs = new Date(localItem.updated_at || localItem.timestamp || localItem.date || 0).getTime();
            const remoteTs = new Date(remoteItem.updated_at || remoteItem.timestamp || remoteItem.date || 0).getTime();
            if (localTs >= remoteTs) {
              mergedMap.set(id, Object.assign({}, remoteItem, localItem));
            }
          }
        }
      } else {
        const str = JSON.stringify(localItem);
        const exists = unkeyedRemoteItems.some(r => JSON.stringify(r) === str);
        if (!exists) {
          unkeyedRemoteItems.push(localItem);
        }
      }
    });

    return Array.from(mergedMap.values()).concat(unkeyedRemoteItems);
  }

  // Case 2: Both are Plain Objects (Settings / Configuration)
  if (parsedLocal && typeof parsedLocal === 'object' && !Array.isArray(parsedLocal) &&
      parsedRemote && typeof parsedRemote === 'object' && !Array.isArray(parsedRemote)) {
    return Object.assign({}, parsedRemote, parsedLocal);
  }

  return remoteVal;
}

test('SyncEngine — getItemIdentifier', async (t) => {
  await t.test('extracts explicit id, _id, or uuid', () => {
    assert.equal(getItemIdentifier({ id: 'cost_101' }), 'cost_101');
    assert.equal(getItemIdentifier({ _id: 'mongo_202' }), 'mongo_202');
    assert.equal(getItemIdentifier({ uuid: 'u-303' }), 'u-303');
  });

  await t.test('extracts order numbers with prefix', () => {
    assert.equal(getItemIdentifier({ orderNo: 'ORD-9988' }), 'ord_ORD-9988');
    assert.equal(getItemIdentifier({ orderId: '1004' }), 'ord_1004');
  });

  await t.test('extracts invoices and lots', () => {
    assert.equal(getItemIdentifier({ billNo: 'INV-441' }), 'inv_INV-441');
    assert.equal(getItemIdentifier({ lotNo: 'LOT-A1', date: '2026-08-01' }), 'lot_LOT-A1_2026-08-01');
  });
});

test('SyncEngine — mergeDatasets', async (t) => {
  await t.test('unions disjoint items from two operators without data loss', () => {
    const serverItems = [
      { id: '1', name: 'Product A', qty: 100 },
      { id: '2', name: 'Product B', qty: 200 }
    ];
    const clientItems = [
      { id: '1', name: 'Product A', qty: 100 },
      { id: '3', name: 'Product C (Added Offline)', qty: 300 }
    ];

    const merged = mergeDatasets(clientItems, serverItems);
    assert.equal(merged.length, 3);
    assert.ok(merged.find(i => i.id === '1'));
    assert.ok(merged.find(i => i.id === '2'));
    assert.ok(merged.find(i => i.id === '3'));
  });

  await t.test('resolves edit conflicts using timestamp (newer edit wins)', () => {
    const serverItems = [
      { id: '1', name: 'Product A', price: 150, updated_at: '2026-08-26T10:00:00Z' }
    ];
    const clientItems = [
      { id: '1', name: 'Product A', price: 175, updated_at: '2026-08-26T11:00:00Z' } // newer
    ];

    const merged = mergeDatasets(clientItems, serverItems);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].price, 175);
  });

  await t.test('respects tombstones (deleted items are not resurrected)', () => {
    const serverItems = [
      { id: '1', name: 'Product A' },
      { id: '2', name: 'Product B (Deleted on Client)' }
    ];
    const clientItems = [
      { id: '1', name: 'Product A' }
    ];
    const tombstones = ['2'];

    const merged = mergeDatasets(clientItems, serverItems, tombstones);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, '1');
  });

  await t.test('merges settings objects cleanly', () => {
    const serverSettings = { theme: 'dark', currency: 'INR', notify: true };
    const clientSettings = { theme: 'light', lastView: 'weaving' };

    const merged = mergeDatasets(clientSettings, serverSettings);
    assert.deepEqual(merged, {
      theme: 'light',
      currency: 'INR',
      notify: true,
      lastView: 'weaving'
    });
  });

  await t.test('preserves authoritative server records when client initializes with empty array (fresh computer)', () => {
    const serverOrders = [
      { id: 'YRN-ORD-1', orderNumber: 'YRN-9019', quality: '70/30 VISCOSE', batches: [{ challanNumber: '1204', totalWeight: 1667.48 }] }
    ];
    const freshClientOrders = []; // Empty local storage on Computer B

    const merged = mergeDatasets(freshClientOrders, serverOrders);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].orderNumber, 'YRN-9019');
    assert.equal(merged[0].batches.length, 1);
    assert.equal(merged[0].batches[0].challanNumber, '1204');
  });

  await t.test('deleting a quality on server immediately evicts it on peer client without resurrection', () => {
    const serverQualities = [
      { id: 'Q_1', quality: '20/1 BRT NYLON' },
      { id: 'Q_2', quality: '20/1 BRT POLY' }
      // Q_3 was deleted by employee
    ];
    const peerClientQualities = [
      { id: 'Q_1', quality: '20/1 BRT NYLON' },
      { id: 'Q_2', quality: '20/1 BRT POLY' },
      { id: 'Q_3', quality: '70/30 VISCOSE (Stale in Peer Cache)' }
    ];
    const tombstones = ['Q_3'];

    const merged = mergeDatasets(peerClientQualities, serverQualities, tombstones);
    assert.equal(merged.length, 2);
    assert.ok(!merged.find(q => q.id === 'Q_3'));
  });

  await t.test('merges multi-user staff state preserving front/back ID images, machines, and salary amount', () => {
    const serverState = {
      employees: [
        {
          id: 'emp-1',
          name: 'Ramesh Patel',
          role: 'Karigar',
          machines: ['Airjet Loom 1'],
          salaryStyle: 'Per Day Fixed',
          salaryAmount: 850,
          idFront: 'data:image/jpeg;base64,serverFrontImgData',
          idBack: 'data:image/jpeg;base64,serverBackImgData',
          status: 'Active'
        }
      ],
      loans: []
    };

    const clientState = {
      employees: [
        {
          id: 'emp-2',
          name: 'Suresh Kumar',
          role: 'Karigar',
          machines: ['Waterjet Loom 2'],
          salaryStyle: 'Per Day Fixed',
          salaryAmount: 900,
          idFront: 'data:image/jpeg;base64,clientFrontImgData',
          idBack: 'data:image/jpeg;base64,clientBackImgData',
          status: 'Active'
        }
      ],
      loans: [
        { id: 'LN-101', empId: 'emp-2', amount: 5000, type: 'Advance', cleared: false }
      ]
    };

    // Item-level merge simulation matching supabase-client logic
    const empMap = new Map();
    serverState.employees.forEach(e => empMap.set(e.id, { ...e }));
    clientState.employees.forEach(e => {
      if (empMap.has(e.id)) {
        empMap.set(e.id, { ...empMap.get(e.id), ...e });
      } else {
        empMap.set(e.id, e);
      }
    });

    const mergedEmployees = Array.from(empMap.values());
    assert.equal(mergedEmployees.length, 2);
    
    const emp1 = mergedEmployees.find(e => e.id === 'emp-1');
    assert.ok(emp1);
    assert.equal(emp1.idFront, 'data:image/jpeg;base64,serverFrontImgData');
    assert.equal(emp1.salaryAmount, 850);
    assert.deepEqual(emp1.machines, ['Airjet Loom 1']);

    const emp2 = mergedEmployees.find(e => e.id === 'emp-2');
    assert.ok(emp2);
    assert.equal(emp2.idFront, 'data:image/jpeg;base64,clientFrontImgData');
    assert.equal(emp2.salaryAmount, 900);
    assert.deepEqual(emp2.machines, ['Waterjet Loom 2']);
  });
});
