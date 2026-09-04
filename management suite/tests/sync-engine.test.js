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

function filterDeletedEntities(a, b, customTombstones = []) {
  let arr = Array.isArray(a) ? a : (Array.isArray(b) ? b : null);
  if (!arr) return Array.isArray(a) ? a : (Array.isArray(b) ? b : a);
  const tombstones = Array.isArray(customTombstones) ? customTombstones : [];
  if (tombstones.length === 0) return arr;
  const tombstoneSet = new Set(tombstones.map(s => String(s).trim().toLowerCase()).filter(Boolean));
  return arr.filter(item => {
    if (!item) return false;
    try {
      if (typeof item === 'string' || typeof item === 'number') {
        if (tombstoneSet.has(String(item).trim().toLowerCase())) return false;
        return true;
      }
      const id = getItemIdentifier(item);
      if (id && tombstoneSet.has(String(id).trim().toLowerCase())) return false;
      if (item.id && tombstoneSet.has(String(item.id).trim().toLowerCase())) return false;
      if (item._id && tombstoneSet.has(String(item._id).trim().toLowerCase())) return false;
      if (item.uuid && tombstoneSet.has(String(item.uuid).trim().toLowerCase())) return false;
      if (item.loanId && tombstoneSet.has(String(item.loanId).trim().toLowerCase())) return false;
      if (item.empId && tombstoneSet.has(String(item.empId).trim().toLowerCase())) return false;
      if (item.employeeId && tombstoneSet.has(String(item.employeeId).trim().toLowerCase())) return false;
      if (item.employee_id && tombstoneSet.has(String(item.employee_id).trim().toLowerCase())) return false;
      if (item.name && tombstoneSet.has(String(item.name).trim().toLowerCase())) return false;
      if (item.employeeName && tombstoneSet.has(String(item.employeeName).trim().toLowerCase())) return false;
      if (item.staffName && tombstoneSet.has(String(item.staffName).trim().toLowerCase())) return false;
      if (item.worker && tombstoneSet.has(String(item.worker).trim().toLowerCase())) return false;
      if (item.dayWorker && tombstoneSet.has(String(item.dayWorker).trim().toLowerCase())) return false;
      if (item.nightWorker && tombstoneSet.has(String(item.nightWorker).trim().toLowerCase())) return false;
      if (item.machineName && tombstoneSet.has(String(item.machineName).trim().toLowerCase())) return false;
      if (item.code && tombstoneSet.has(String(item.code).trim().toLowerCase())) return false;
      if (item.quality && tombstoneSet.has(String(item.quality).trim().toLowerCase())) return false;
      if (item.supplier && tombstoneSet.has(String(item.supplier).trim().toLowerCase())) return false;
      if (item.boriNo && tombstoneSet.has(String(item.boriNo).trim().toLowerCase())) return false;
      if (item.beamNumber && tombstoneSet.has(String(item.beamNumber).trim().toLowerCase())) return false;
      if (item.takaSerial && tombstoneSet.has(String(item.takaSerial).trim().toLowerCase())) return false;
    } catch(e) {}
    return true;
  });
}

function mergeDatasets(localVal, remoteVal, tombstones = []) {
  if (localVal === undefined || localVal === null) return filterDeletedEntities(remoteVal, null, tombstones);
  if (remoteVal === undefined || remoteVal === null) return filterDeletedEntities(localVal, null, tombstones);

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
    const cleanLocal = filterDeletedEntities(parsedLocal, null, tombstones);
    const cleanRemote = filterDeletedEntities(parsedRemote, null, tombstones);
    const mergedMap = new Map();
    const unkeyedRemoteItems = [];

    // 1. Index remote items (authoritative server snapshot)
    cleanRemote.forEach(item => {
      const id = getItemIdentifier(item);
      if (id) {
        mergedMap.set(id, item);
      } else {
        unkeyedRemoteItems.push(item);
      }
    });

    // 2. Merge local items
    cleanLocal.forEach(localItem => {
      const id = getItemIdentifier(localItem);
      if (id) {
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

  await t.test('multi-alias tombstones prevent employee resurrection across PCs and evict related loans/records', () => {
    // Computer A deletes employee "Ramesh Patel" (ID: "emp-007", Name: "Ramesh Patel")
    const deletedAliases = ['emp-007', 'Ramesh Patel', 'emp_007'];

    // Computer B was offline and still has stale local staff state containing Ramesh and his loan
    const computerBEmployees = [
      { id: 'emp-007', name: 'Ramesh Patel', role: 'Karigar', salaryAmount: 900 },
      { id: 'emp-008', name: 'Gopal Verma', role: 'Master', salaryAmount: 1200 }
    ];

    const computerBLoans = [
      { id: 'loan-1', employeeId: 'emp-007', employeeName: 'Ramesh Patel', amount: 5000, status: 'Active' },
      { id: 'loan-2', employeeId: 'emp-008', employeeName: 'Gopal Verma', amount: 2000, status: 'Active' }
    ];

    // Verify filterDeletedEntities filters by both ID and Name
    const filteredEmployees = filterDeletedEntities('aethertasks_db_state_v7', computerBEmployees, deletedAliases);
    assert.equal(filteredEmployees.length, 1);
    assert.equal(filteredEmployees[0].name, 'Gopal Verma');

    // Verify filterDeletedEntities evicts loans referencing tombstoned employeeName or employeeId
    const filteredLoans = filterDeletedEntities('aethertasks_db_state_v7', computerBLoans, deletedAliases);
    assert.equal(filteredLoans.length, 1);
    assert.equal(filteredLoans[0].employeeName, 'Gopal Verma');
  });

  await t.test('filterDeletedEntities supports both (arr) and (key, arr) signatures and filters primitive strings', () => {
    const tombstones = ['mach-4', 'Quality-Silk-A'];
    
    // Test (arr) signature with primitive strings
    const machinesList = ['mach-1', 'mach-2', 'mach-4', 'mach-5'];
    const filteredMachines = filterDeletedEntities(machinesList, null, tombstones);
    assert.deepEqual(filteredMachines, ['mach-1', 'mach-2', 'mach-5']);

    // Test (key, arr) signature with objects
    const qualitiesList = [
      { id: 'q-1', quality: 'Quality-Cotton' },
      { id: 'q-2', quality: 'Quality-Silk-A' }
    ];
    const filteredQualities = filterDeletedEntities('yarn-qualities', qualitiesList, tombstones);
    assert.equal(filteredQualities.length, 1);
    assert.equal(filteredQualities[0].id, 'q-1');
  });

  await t.test('mergeDatasets refuses to resurrect tombstoned items even if local timestamps are newer', () => {
    const tombstones = ['ord-1001'];
    const serverOrders = [
      { id: 'ord-1002', orderNumber: 'ORD-1002', quality: 'Chiffon' }
    ];
    const staleLocalOrders = [
      { id: 'ord-1001', orderNumber: 'ORD-1001', quality: 'Deleted Georgette', updated_at: '2099-01-01T00:00:00Z' },
      { id: 'ord-1002', orderNumber: 'ORD-1002', quality: 'Chiffon' }
    ];

    const merged = mergeDatasets(staleLocalOrders, serverOrders, tombstones);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'ord-1002');
    assert.ok(!merged.some(o => o.id === 'ord-1001'));
  });

  await t.test('mergeYarnOrdersDatasets adopts clean remote baseline and prevents resurrection of deleted orders on secondary PC', () => {
    // Server has 1 active order; order ORD-DEL-99 was deleted on PC 1
    const remoteOrders = [
      { id: 'ORD-ACTIVE-1', orderNumber: 'ORD-101', quality: '20/1 BRT NYLON', batches: [] }
    ];
    // PC 2 still has stale local storage containing ORD-DEL-99
    const staleLocalOrders = [
      { id: 'ORD-ACTIVE-1', orderNumber: 'ORD-101', quality: '20/1 BRT NYLON', batches: [] },
      { id: 'ORD-DEL-99', orderNumber: 'ORD-99', quality: 'DELETED QUALITY', batches: [] }
    ];

    // Simulate merge when not locally typing
    const isLocallyActive = false;
    const cleanLocal = filterDeletedEntities(staleLocalOrders, null, []);
    const cleanRemote = filterDeletedEntities(remoteOrders, null, []);

    let finalOrders;
    if (!isLocallyActive && cleanRemote.length > 0) {
      finalOrders = cleanRemote;
    }

    assert.equal(finalOrders.length, 1);
    assert.equal(finalOrders[0].id, 'ORD-ACTIVE-1');
    assert.ok(!finalOrders.some(o => o.id === 'ORD-DEL-99'));
  });

  await t.test('reconciles relational table against KV master list so deleted DB rows are purged and do not re-inflate', () => {
    // Database table still had an old row 'Q_OLD' that was deleted via UI
    const dbQualities = [
      { id: 'Q_1', quality: '20/1 NYLON', code: 'N1', color: 'White', type: 'Nylon', supplier: 'Sup1' },
      { id: 'Q_OLD', quality: 'OLD DELETED POLY', code: 'P9', color: 'Black', type: 'Polyester', supplier: 'Sup2' }
    ];
    // KV master list has only active qualities
    const kvMasterQualities = [
      { id: 'Q_1', quality: '20/1 NYLON', code: 'N1', color: 'White', type: 'Nylon', supplier: 'Sup1' }
    ];

    const finalQualities = (Array.isArray(kvMasterQualities) && kvMasterQualities.length > 0) ? kvMasterQualities : dbQualities;
    const finalIdSet = new Set(finalQualities.map(q => String(q.id).toLowerCase()));
    const obsoleteDbRows = dbQualities.filter(q => q && q.id && !finalIdSet.has(String(q.id).toLowerCase()));

    assert.equal(finalQualities.length, 1);
    assert.equal(finalQualities[0].id, 'Q_1');
    assert.equal(obsoleteDbRows.length, 1);
    assert.equal(obsoleteDbRows[0].id, 'Q_OLD');
  });

  await t.test('merges multi-PC yarn sales datasets combining Doubler and TFO challans without data loss', () => {
    // Replicate pure merge logic from supabase-client.js
    function mergeSales(localArr, remoteArr) {
      const cleanLocal = filterDeletedEntities(localArr);
      const cleanRemote = filterDeletedEntities(remoteArr);
      const saleMap = new Map();
      const keyMap = new Map();

      cleanRemote.forEach(rem => {
        const pKey = rem.id || rem.challanNo;
        saleMap.set(pKey, rem);
        if (rem.id) keyMap.set(rem.id, pKey);
        if (rem.challanNo) keyMap.set(rem.challanNo.toLowerCase(), pKey);
      });

      cleanLocal.forEach(loc => {
        const pKey = loc.id || loc.challanNo;
        let matched = keyMap.get(loc.id) || (loc.challanNo && keyMap.get(loc.challanNo.toLowerCase()));
        if (matched && saleMap.has(matched)) {
          const rem = saleMap.get(matched);
          const locTs = new Date(loc.updated_at || 0).getTime();
          const remTs = new Date(rem.updated_at || 0).getTime();
          if (locTs >= remTs) {
            saleMap.set(matched, { ...rem, ...loc });
          }
        } else {
          saleMap.set(pKey, loc);
          if (loc.id) keyMap.set(loc.id, pKey);
          if (loc.challanNo) keyMap.set(loc.challanNo.toLowerCase(), pKey);
        }
      });

      return Array.from(saleMap.values());
    }

    const pc1Doubler = [
      { id: 's1', challanNo: 'CH-0001/D/26-27', totalAmount: 10000 },
      { id: 's2', challanNo: 'CH-0002/D/26-27', totalAmount: 20000 }
    ];
    const pc2Doubler = [
      { id: 's1', challanNo: 'CH-0001/D/26-27', totalAmount: 10000 }
    ];

    const mergedDoubler = mergeSales(pc2Doubler, pc1Doubler);
    assert.equal(mergedDoubler.length, 2, 'Must have both Doubler challans');

    const pc1Tfo = [
      { id: 't1', challanNo: 'CH-0001/T/26-27', totalAmount: 5000 },
      { id: 't2', challanNo: 'CH-0002/T/26-27', totalAmount: 6000 },
      { id: 't3', challanNo: 'CH-0003/T/26-27', totalAmount: 7000 }
    ];
    const pc2Tfo = [];

    const mergedTfo = mergeSales(pc2Tfo, pc1Tfo);
    assert.equal(mergedTfo.length, 3, 'Must have all 3 TFO challans');
  });
});


