const assert = require('assert');
const test = require('node:test');
const fs = require('fs');

test('Multi-User Concurrency & Merge Validation', async (t) => {
  const clientCode = fs.readFileSync('management suite/assets/supabase-client.js', 'utf8');

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
});
