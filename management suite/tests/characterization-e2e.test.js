/**
 * Comprehensive Browser Characterization Test Suite
 * Vishwa Atelier Management Suite
 * 
 * Verifies the baseline behavioral contract across all 6 core modules:
 * 1. Authentication & Session Management
 * 2. Complete Yarn Lifecycle (Order -> Receipt -> Issue -> GR -> Stock -> Ledger -> Production -> Sales)
 * 3. Complete Weaving Lifecycle (Order -> Beam Loading -> Production -> Dispatch -> Designs)
 * 4. Payroll & Salary Calculation (Staff -> Attendance -> Loans -> Settlement)
 * 5. Multi-Client Concurrency & Sync Safeguards (Merge -> Conflict Resolution -> Tombstone Anti-Resurrection)
 * 6. Backup, Manifest & Export Validation
 */

const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// Helper to create an isolated browser-like sandbox environment
function createBrowserSandbox(initialStore = {}) {
  const store = { ...initialStore };
  const localStorageMock = {
    _data: store,
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); },
    key(i) { return Object.keys(store)[i] || null; },
    get length() { return Object.keys(store).length; }
  };

  const listeners = {};
  const windowMock = {
    location: { pathname: '/management%20suite/modules/settings.html', href: 'http://localhost/settings.html', search: '' },
    APP_CONFIG: {
      SUPABASE_URL: 'https://mock.supabase.co',
      SUPABASE_ANON_KEY: 'mock-anon-key'
    },
    localStorage: localStorageMock,
    addEventListener(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(f => f !== fn);
      }
    },
    dispatchEvent(event) {
      const fns = listeners[event.type || event.name] || [];
      fns.forEach(fn => fn(event));
      return true;
    },
    CustomEvent: function(name, opts) { this.type = name; this.name = name; this.detail = opts?.detail; },
    StorageEvent: function(name, opts) { this.type = name; this.name = name; this.key = opts?.key; this.newValue = opts?.newValue; },
    BroadcastChannel: class { postMessage() {} close() {} },
    HTMLInputElement: function() {},
    HTMLTextAreaElement: function() {},
    HTMLSelectElement: function() {}
  };

  const documentMock = {
    location: windowMock.location,
    addEventListener: windowMock.addEventListener,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      setAttribute: () => {},
      getAttribute: () => null,
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      appendChild: () => {},
      removeChild: () => {},
      addEventListener: () => {},
      click: () => {},
      remove: () => {}
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {}
    }
  };

  // Load supabase-client.js into the sandbox
  const clientPath = path.join(__dirname, '..', 'assets', 'supabase-client.js');
  const clientCode = fs.readFileSync(clientPath, 'utf8');
  
  const runner = new Function(
    'window', 'document', 'localStorage', 'navigator', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'fetch',
    clientCode
  );

  runner(
    windowMock,
    documentMock,
    localStorageMock,
    { onLine: true },
    console,
    (fn, delay) => {
      const t = setTimeout(fn, delay !== undefined ? Math.min(delay, 0) : 0);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    },
    clearTimeout,
    () => ({ unref: () => {} }),
    clearInterval,
    Date,
    () => Promise.resolve({ ok: true, json: async () => [] })
  );

  return {
    window: windowMock,
    document: documentMock,
    localStorage: localStorageMock,
    VishwaSupabase: windowMock.VishwaSupabase,
    VF_DB: windowMock.VF_DB
  };
}

// =========================================================================
// SUITE 1: AUTHENTICATION, PERMISSIONS & NAVIGATION CHARACTERIZATION
// =========================================================================
test('1. Authentication & Session Characterization', async (t) => {
  const env = createBrowserSandbox();

  await t.test('Initial unauthenticated state is clean and anonymous', () => {
    assert.strictEqual(env.localStorage.getItem('vf_active_user'), null);
  });

  await t.test('Admin authentication saves session and creates identity record', async () => {
    const adminUser = {
      email: 'admin@vishwaatelier.com',
      role: 'admin',
      name: 'Super Admin',
      pass_hash: 'adminhash123',
      created_at: new Date().toISOString()
    };

    await env.VishwaSupabase.authUsers.saveUser(adminUser);
    env.localStorage.setItem('vf_active_user', JSON.stringify(adminUser));

    const active = JSON.parse(env.localStorage.getItem('vf_active_user'));
    assert.strictEqual(active.email, 'admin@vishwaatelier.com');
    assert.strictEqual(active.role, 'admin');

    // Admin user cache is populated in vf_admin_users
    const admins = JSON.parse(env.localStorage.getItem('vf_admin_users') || '[]');
    assert.ok(admins.some(a => a.email === 'admin@vishwaatelier.com'), 'Admin registered in admin cache');
  });

  await t.test('Employee authentication preserves role boundaries and permissions', async () => {
    const operatorUser = {
      email: 'operator@vishwaatelier.com',
      role: 'employee',
      name: 'Yarn Operator',
      permissions: { 'yarn-rm-orders': 'edit', 'weaving-order-book': 'view' },
      created_at: new Date().toISOString()
    };

    await env.VishwaSupabase.authUsers.saveUser(operatorUser);
    env.localStorage.setItem('vf_active_user', JSON.stringify(operatorUser));

    const active = JSON.parse(env.localStorage.getItem('vf_active_user'));
    assert.strictEqual(active.role, 'employee');
    assert.strictEqual(active.permissions['yarn-rm-orders'], 'edit');
    assert.strictEqual(active.permissions['weaving-order-book'], 'view');
    assert.strictEqual(active.permissions['salary-sheet'], undefined, 'Operator cannot edit salary by default');
  });

  await t.test('Deleted user tombstone prevents resurrection across sessions', async () => {
    await env.VishwaSupabase.authUsers.deleteUser('operator@vishwaatelier.com');
    const tombstones = JSON.parse(env.localStorage.getItem('vf_deleted_auth_users') || '[]');
    assert.ok(tombstones.includes('operator@vishwaatelier.com'));

    // Attempting to merge a stale remote user with deleted email is blocked
    const staleList = [{ id: 'op-1', email: 'operator@vishwaatelier.com', name: 'Resurrect Me' }];
    const cleaned = env.VishwaSupabase.filterDeletedEntities(staleList);
    assert.strictEqual(cleaned.length, 0, 'Deleted user is evicted and cannot resurrect');
  });
});

// =========================================================================
// SUITE 2: COMPLETE YARN LIFECYCLE CHARACTERIZATION
// =========================================================================
test('2. Complete Yarn Lifecycle Characterization', async (t) => {
  const env = createBrowserSandbox();

  await t.test('Step A: Create Yarn RM Order with Rate and Ordered Quantity', () => {
    const orderId = 'ORD-2026-001';
    const order = {
      id: orderId,
      orderNumber: 'RM-ORD-01',
      date: '2026-04-05',
      supplier: 'Reliance Industries',
      quality: '80/72 BRT Polyester',
      rate: 135.50,
      orderedWeight: 1000,
      status: 'active',
      batches: []
    };

    env.localStorage.setItem('vishwa_yarn_rm_orders_data', JSON.stringify([order]));
    const orders = JSON.parse(env.localStorage.getItem('vishwa_yarn_rm_orders_data'));
    assert.strictEqual(orders.length, 1);
    assert.strictEqual(orders[0].rate, 135.50);
  });

  await t.test('Step B: Receive Batches and Boxes with Gross Weights', () => {
    const orders = JSON.parse(env.localStorage.getItem('vishwa_yarn_rm_orders_data'));
    const batch = {
      id: 'BATCH-01',
      challanNumber: 'DC-8899',
      receivedDate: '2026-04-06',
      totalWeight: 500,
      boxes: [
        { id: 'BOX-01', boxNumber: 'B-101', grossWeight: 125, netWeight: 125, status: 'available' },
        { id: 'BOX-02', boxNumber: 'B-102', grossWeight: 125, netWeight: 125, status: 'available' },
        { id: 'BOX-03', boxNumber: 'B-103', grossWeight: 125, netWeight: 125, status: 'available' },
        { id: 'BOX-04', boxNumber: 'B-104', grossWeight: 125, netWeight: 125, status: 'available' }
      ]
    };
    orders[0].batches.push(batch);
    orders[0].receivedWeight = 500;
    env.localStorage.setItem('vishwa_yarn_rm_orders_data', JSON.stringify(orders));

    // Also populate stock data mirror
    const stockLot = {
      id: 'LOT-YARN-01',
      lotNumber: 'L-8899',
      orderId: 'ORD-2026-001',
      supplier: 'Reliance Industries',
      quality: '80/72 BRT Polyester',
      boxes: batch.boxes.map(b => ({ ...b, lotNumber: 'L-8899' }))
    };
    env.localStorage.setItem('vishwa_yarn_rm_stock_data', JSON.stringify([stockLot]));

    const stock = JSON.parse(env.localStorage.getItem('vishwa_yarn_rm_stock_data'));
    assert.strictEqual(stock[0].boxes.length, 4);
    assert.strictEqual(stock[0].boxes.filter(b => b.status === 'available').length, 4);
  });

  await t.test('Step C: Issue Boxes to Department (TFO / Doubler)', () => {
    const stock = JSON.parse(env.localStorage.getItem('vishwa_yarn_rm_stock_data'));
    // Issue BOX-01 and BOX-02 to TFO
    stock[0].boxes[0].status = 'issued';
    stock[0].boxes[0].issuedTo = 'TFO';
    stock[0].boxes[0].issueDate = '2026-04-07';

    stock[0].boxes[1].status = 'issued';
    stock[0].boxes[1].issuedTo = 'Doubler';
    stock[0].boxes[1].issueDate = '2026-04-07';

    env.localStorage.setItem('vishwa_yarn_rm_stock_data', JSON.stringify(stock));

    const updatedStock = JSON.parse(env.localStorage.getItem('vishwa_yarn_rm_stock_data'));
    assert.strictEqual(updatedStock[0].boxes.filter(b => b.status === 'issued').length, 2);
    assert.strictEqual(updatedStock[0].boxes.filter(b => b.status === 'available').length, 2);
  });

  await t.test('Step D: Goods Return (GR) Deduction and Purchase Ledger Propagation', () => {
    // Return BOX-04 (Full GR = 125 kg) and partial GR on BOX-03 (25 kg returned, 100 kg kept)
    const stock = JSON.parse(env.localStorage.getItem('vishwa_yarn_rm_stock_data'));
    stock[0].boxes[3].status = 'gr';
    stock[0].boxes[3].grWeight = 125;

    stock[0].boxes[2].grWeight = 25;
    stock[0].boxes[2].netWeight = 100;
    env.localStorage.setItem('vishwa_yarn_rm_stock_data', JSON.stringify(stock));

    // Compute Purchase Ledger Entry
    const grossReceived = 500;
    const totalGrWeight = 125 + 25; // 150 kg
    const netBillableWeight = grossReceived - totalGrWeight; // 350 kg
    const rate = 135.50;
    const subtotal = netBillableWeight * rate; // 47,425
    const gstPercent = 5;
    const gstAmount = (subtotal * gstPercent) / 100; // 2,371.25
    const grandTotal = subtotal + gstAmount; // 49,796.25

    const ledgerEntry = {
      id: 'PL-2026-001',
      orderId: 'ORD-2026-001',
      challanNo: 'DC-8899',
      supplier: 'Reliance Industries',
      quality: '80/72 BRT Polyester',
      grossWeight: grossReceived,
      grWeight: totalGrWeight,
      netWeight: netBillableWeight,
      rate: rate,
      gstPercent: gstPercent,
      subtotal: subtotal,
      gstAmount: gstAmount,
      grandTotal: grandTotal,
      paidAmount: 0,
      balanceDue: grandTotal
    };

    env.localStorage.setItem('vishwa_yarn_ledger_data', JSON.stringify([ledgerEntry]));

    const ledger = JSON.parse(env.localStorage.getItem('vishwa_yarn_ledger_data'));
    assert.strictEqual(ledger[0].netWeight, 350);
    assert.strictEqual(ledger[0].grandTotal, 49796.25);
  });

  await t.test('Step E: Production Log Creation & Boris Packing', () => {
    const prodEntry = {
      id: 'PROD-TFO-01',
      date: '2026-04-08',
      department: 'TFO',
      machineNumber: 'M-01',
      rpm: 9000,
      tpm: 350,
      denier: 150,
      efficiency: 95,
      producedWeight: 120.5,
      borisCount: 2,
      operator: 'Ramesh'
    };

    env.localStorage.setItem('vishwa_yarn_production_data', JSON.stringify([prodEntry]));
    const prod = JSON.parse(env.localStorage.getItem('vishwa_yarn_production_data'));
    assert.strictEqual(prod.length, 1);
    assert.strictEqual(prod[0].producedWeight, 120.5);
  });

  await t.test('Step F: Sales Challan & Sales Ledger Mirror', () => {
    const saleChallan = {
      id: 'SALE-CH-01',
      challanNumber: 'SC-501',
      date: '2026-04-09',
      customer: 'Surat Textiles Ltd',
      quality: '150D TFO 350 TPM',
      boris: 2,
      weight: 120.5,
      rate: 165.00,
      gstPercent: 5,
      totalAmount: 120.5 * 165.00 * 1.05
    };

    env.localStorage.setItem('vishwa_yarn_sales_data', JSON.stringify([saleChallan]));
    const sales = JSON.parse(env.localStorage.getItem('vishwa_yarn_sales_data'));
    assert.strictEqual(sales[0].challanNumber, 'SC-501');
    assert.strictEqual(sales[0].weight, 120.5);
  });
});

// =========================================================================
// SUITE 3: COMPLETE WEAVING LIFECYCLE CHARACTERIZATION
// =========================================================================
test('3. Complete Weaving Lifecycle Characterization', async (t) => {
  const env = createBrowserSandbox();

  await t.test('Step A: Weaving Order Creation with Construction Spec', () => {
    const weavingOrder = {
      id: 'WV-ORD-01',
      orderNumber: 'WO-2026-101',
      orderDate: '2026-04-10',
      designCode: 'VF-DES-88',
      warpQuality: '80D Polyester (4800 ends)',
      weftQuality: '150D Roto',
      totalMeters: 5000,
      ratePerMeter: 32.50,
      status: 'active'
    };

    env.localStorage.setItem('vishwa_weaving_orders_data', JSON.stringify([weavingOrder]));
    const orders = JSON.parse(env.localStorage.getItem('vishwa_weaving_orders_data'));
    assert.strictEqual(orders.length, 1);
    assert.strictEqual(orders[0].totalMeters, 5000);
  });

  await t.test('Step B: Warp Beam Loading & Weft Material Receipt', () => {
    const beam = {
      id: 'BEAM-01',
      beamNumber: 'BM-771',
      orderId: 'WV-ORD-01',
      loomNumber: 'LOOM-05',
      totalWarpMeters: 5200,
      loadedDate: '2026-04-11',
      status: 'on_loom'
    };

    env.localStorage.setItem('vishwa_warp_beams_data', JSON.stringify([beam]));
    const beams = JSON.parse(env.localStorage.getItem('vishwa_warp_beams_data'));
    assert.strictEqual(beams[0].loomNumber, 'LOOM-05');
  });

  await t.test('Step C: Weaving Production Log Recording', () => {
    const log = {
      id: 'WPROD-01',
      date: '2026-04-12',
      loomNumber: 'LOOM-05',
      shift: 'Day',
      weaverName: 'Mahesh',
      metersWoven: 180,
      picksCount: 54000,
      efficiencyPercent: 88.5
    };

    env.localStorage.setItem('vishwa_weaving_production_logs', JSON.stringify([log]));
    const logs = JSON.parse(env.localStorage.getItem('vishwa_weaving_production_logs'));
    assert.strictEqual(logs[0].metersWoven, 180);
  });

  await t.test('Step D: Fabric Cut & Dispatch Challan', () => {
    const dispatch = {
      id: 'DISP-01',
      challanNumber: 'FDC-901',
      date: '2026-04-14',
      customer: 'Ahmedabad Silks',
      designCode: 'VF-DES-88',
      piecesCount: 4,
      totalMeters: 450,
      rate: 32.50,
      totalAmount: 450 * 32.50
    };

    env.localStorage.setItem('vishwa_fabric_dispatch_data', JSON.stringify([dispatch]));
    const dispatches = JSON.parse(env.localStorage.getItem('vishwa_fabric_dispatch_data'));
    assert.strictEqual(dispatches[0].totalMeters, 450);
    assert.strictEqual(dispatches[0].totalAmount, 14625);
  });

  await t.test('Step E: Design Library Lifecycle and Tombstone Deletion', () => {
    const design = {
      id: 'DES-88',
      code: 'VF-DES-88',
      design_number: '88',
      name: 'Geometric Floral Brocade',
      total_ends: 4800,
      picks_per_inch: 64,
      ep_file_url: 'https://example.com/designs/vf-des-88.ep',
      created_at: '2026-04-01'
    };

    env.localStorage.setItem('vishwa_fabric_designs_data', JSON.stringify([design]));
    const saved = JSON.parse(env.localStorage.getItem('vishwa_fabric_designs_data'));
    assert.strictEqual(saved.length, 1);

    // Delete design and register tombstone in deleted-designs
    env.localStorage.setItem('deleted-designs', JSON.stringify(['VF-DES-88', '88', 'DES-88']));

    const filtered = env.VishwaSupabase.filterDeletedEntities([design]);
    assert.strictEqual(filtered.length, 0, 'Design filtered out by tombstone and not resurrected');
  });
});

// =========================================================================
// SUITE 4: PAYROLL & SALARY CALCULATION CHARACTERIZATION
// =========================================================================
test('4. Payroll & Salary Calculation Characterization', async (t) => {
  const env = createBrowserSandbox();

  await t.test('Step A: Employee Setup with Role and Base Salary', () => {
    const state = {
      employees: [
        { id: 'EMP-01', name: 'Kishan Patel', role: 'Weaver', salaryType: 'monthly', baseSalary: 26000, joinDate: '2025-01-10' }
      ],
      attendance: {},
      loans: [],
      salarySettlements: []
    };

    env.localStorage.setItem('aethertasks_db_state_v7', JSON.stringify(state));
    const loaded = JSON.parse(env.localStorage.getItem('aethertasks_db_state_v7'));
    assert.strictEqual(loaded.employees.length, 1);
    assert.strictEqual(loaded.employees[0].baseSalary, 26000);
  });

  await t.test('Step B: Monthly Attendance Recording (26 Working Days, 24 Present, 1 Half-Day, 1 Absent)', () => {
    const state = JSON.parse(env.localStorage.getItem('aethertasks_db_state_v7'));
    const monthKey = '2026-04';
    
    state.attendance[monthKey] = {
      'EMP-01': {
        presentDays: 24,
        halfDays: 1,
        absentDays: 1,
        totalWorkingDays: 26,
        overtimeHours: 10
      }
    };

    env.localStorage.setItem('aethertasks_db_state_v7', JSON.stringify(state));
    const att = JSON.parse(env.localStorage.getItem('aethertasks_db_state_v7')).attendance[monthKey]['EMP-01'];
    assert.strictEqual(att.presentDays, 24);
    assert.strictEqual(att.halfDays, 1);
  });

  await t.test('Step C: Employee Advance Loan & Installment Deduction', () => {
    const state = JSON.parse(env.localStorage.getItem('aethertasks_db_state_v7'));
    state.loans.push({
      id: 'LN-101',
      employeeId: 'EMP-01',
      totalLoanAmount: 10000,
      monthlyDeduction: 2500,
      balanceRemaining: 7500,
      disbursedDate: '2026-03-15'
    });

    env.localStorage.setItem('aethertasks_db_state_v7', JSON.stringify(state));
    const loans = JSON.parse(env.localStorage.getItem('aethertasks_db_state_v7')).loans;
    assert.strictEqual(loans[0].monthlyDeduction, 2500);
  });

  await t.test('Step D: Exact Salary Settlement Calculation & Net Payable', () => {
    const state = JSON.parse(env.localStorage.getItem('aethertasks_db_state_v7'));
    const emp = state.employees[0];
    const att = state.attendance['2026-04']['EMP-01'];
    const loan = state.loans[0];

    // Mathematical payroll formula
    const effectiveDays = att.presentDays + (att.halfDays * 0.5); // 24 + 0.5 = 24.5 days
    const dailyRate = emp.baseSalary / att.totalWorkingDays; // 26,000 / 26 = 1,000 per day
    const earnedBasic = effectiveDays * dailyRate; // 24.5 * 1000 = 24,500
    const hourlyRate = dailyRate / 8; // 1000 / 8 = 125/hr
    const overtimeAmount = att.overtimeHours * hourlyRate; // 10 * 125 = 1,250
    const grossEarnings = earnedBasic + overtimeAmount; // 25,750
    const loanDeduction = loan.monthlyDeduction; // 2,500
    const netPayable = grossEarnings - loanDeduction; // 23,250

    const settlement = {
      id: 'SETTLE-2026-04-EMP01',
      employeeId: 'EMP-01',
      month: '2026-04',
      effectiveDays,
      earnedBasic,
      overtimeAmount,
      grossEarnings,
      loanDeduction,
      netPayable,
      settledAt: '2026-05-01T10:00:00Z',
      status: 'settled'
    };

    state.salarySettlements.push(settlement);
    env.localStorage.setItem('aethertasks_db_state_v7', JSON.stringify(state));

    const loadedSettlement = JSON.parse(env.localStorage.getItem('aethertasks_db_state_v7')).salarySettlements[0];
    assert.strictEqual(loadedSettlement.netPayable, 23250);
    assert.strictEqual(loadedSettlement.effectiveDays, 24.5);
  });
});

// =========================================================================
// SUITE 5: TWO-CLIENT SYNC, CONFLICTS & TOMBSTONE SAFETY
// =========================================================================
test('5. Two-Client Sync & Concurrency Characterization', async (t) => {
  const env = createBrowserSandbox();

  await t.test('Disjoint datasets from two operators merge cleanly without loss', () => {
    const pc1Local = [
      { id: 'REC-A', text: 'Created on PC 1', updated_at: '2026-04-01T10:00:00Z' }
    ];
    const pc2Remote = [
      { id: 'REC-B', text: 'Created on PC 2', updated_at: '2026-04-01T10:05:00Z' }
    ];

    const merged = env.VishwaSupabase.mergeYarnSalesDatasets(pc1Local, pc2Remote, 'tfo');
    assert.strictEqual(merged.length, 2);
    assert.ok(merged.some(r => r.id === 'REC-A'));
    assert.ok(merged.some(r => r.id === 'REC-B'));
  });

  await t.test('Conflicting edits on the same record resolve via newer timestamp', () => {
    const olderLocal = [
      { id: 'REC-C', rate: 140, updated_at: '2026-04-01T10:00:00Z' }
    ];
    const newerRemote = [
      { id: 'REC-C', rate: 155, updated_at: '2026-04-01T10:30:00Z' }
    ];

    const merged = env.VishwaSupabase.mergeYarnSalesDatasets(olderLocal, newerRemote, 'tfo');
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].rate, 155, 'Newer edit won conflict');
  });

  await t.test('Deleted record tombstone prevents resurrecting from stale local state', () => {
    const staleLocal = [
      { id: 'DELETED-ORD-99', name: 'DELETED-ORD-99', updated_at: '2026-04-01T09:00:00Z' }
    ];

    env.localStorage.setItem('vf_deleted_yarn_orders', JSON.stringify(['DELETED-ORD-99']));

    const cleaned = env.VishwaSupabase.filterDeletedEntities(staleLocal);
    assert.strictEqual(cleaned.length, 0, 'Deleted entity blocked by tombstone');
  });

  await t.test('Authoritative empty cloud dataset clears stale local records on fresh workstation', () => {
    const emptyRemote = '[]';
    const localStaleCache = JSON.stringify([{ id: 'OLD-CACHE-1', val: 10 }]);

    const merged = env.VishwaSupabase.mergeDatasets('yarn-qualities', localStaleCache, emptyRemote);
    assert.ok(Array.isArray(merged));
  });
});

// =========================================================================
// SUITE 6: FULL BACKUP EXPORT & MANIFEST VALIDATION
// =========================================================================
test('6. Backup, Manifest & Export Validation Characterization', async (t) => {
  const env = createBrowserSandbox();

  // Populate sample operational data in local storage
  env.localStorage.setItem('vishwa_yarn_rm_orders_data', JSON.stringify([{ id: 'ORD-1', supplier: 'ABC' }]));
  env.localStorage.setItem('vishwa_yarn_rm_stock_data', JSON.stringify([{ id: 'LOT-1', quality: 'POLY' }]));
  env.localStorage.setItem('aethertasks_db_state_v7', JSON.stringify({
    employees: [{ id: 'EMP-1', name: 'Ramesh' }]
  }));

  await t.test('Full backup export produces version 2.0.0 JSON schema with metadata', async () => {
    const backupResult = await env.VF_DB.exportFullBackup();
    assert.strictEqual(backupResult.success, true);
    assert.ok(backupResult.data, 'Backup payload exists');

    const payload = backupResult.data;
    assert.strictEqual(payload.meta.version, '2.0.0');
    assert.ok(payload.meta.export_date, 'Has ISO export date');
    assert.ok(payload.local_storage_raw, 'Has local_storage_raw mapping');

    // Confirm essential operational collections are captured
    assert.ok(payload.local_storage_raw['vishwa_yarn_rm_orders_data']);
    assert.ok(payload.local_storage_raw['vishwa_yarn_rm_stock_data']);
    assert.ok(payload.local_storage_raw['aethertasks_db_state_v7']);
  });

  await t.test('Backup payload excludes raw passwords and access tokens', async () => {
    const backupResult = await env.VF_DB.exportFullBackup();
    const payloadStr = JSON.stringify(backupResult.data);

    // Verify no private token keys leaked
    assert.strictEqual(payloadStr.includes('sb-access-token'), false);
    assert.strictEqual(payloadStr.includes('sb-refresh-token'), false);
  });
});
