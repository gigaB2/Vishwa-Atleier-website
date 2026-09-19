const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const clientCode = fs.readFileSync(path.join(__dirname, '../assets/supabase-client.js'), 'utf8');

function setupTestEnvironment(initialLocalStorage = {}) {
  const store = { ...initialLocalStorage };
  const mockLocalStorage = {
    _data: store,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] || null
  };

  const sandbox = {
    window: {
      location: { pathname: '/management%20suite/modules/settings.html', href: 'http://localhost/settings.html' },
      addEventListener: () => {},
      dispatchEvent: () => {},
      CustomEvent: function(name, opts) { this.type = name; this.detail = opts?.detail; },
      StorageEvent: function(name, opts) { this.type = name; this.key = opts?.key; this.newValue = opts?.newValue; },
      APP_CONFIG: {
        SUPABASE_URL: 'https://mock.supabase.co',
        SUPABASE_ANON_KEY: 'mock-key'
      },
      BroadcastChannel: class { postMessage() {} close() {} }
    },
    document: {
      location: { pathname: '/management%20suite/modules/settings.html', href: 'http://localhost/settings.html' },
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    localStorage: mockLocalStorage,
    navigator: { onLine: true },
    console: console,
    setTimeout: (fn, delay) => {
      const t = setTimeout(fn, delay !== undefined ? Math.min(delay, 0) : 0);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    },
    clearTimeout: () => {},
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    Date: Date,
    fetch: () => Promise.resolve({ ok: true, json: async () => [] })
  };

  const fn = new Function('window', 'document', 'localStorage', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'fetch', clientCode);
  fn(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.console, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval, sandbox.clearInterval, sandbox.Date, sandbox.fetch);

  return {
    window: sandbox.window,
    localStorage: sandbox.localStorage,
    VishwaSupabase: sandbox.window.VishwaSupabase
  };
}

test('1. getItemIdentifier correctly recognizes user email as unique cross-device key', () => {
  const env = setupTestEnvironment();
  const mergeFn = env.VishwaSupabase.mergeDatasets;

  const userA = { id: 'emp-101', email: 'DHRUV@VISHWAFASHIONS.COM', role: 'employee' };
  const userB = { id: 'emp-102', email: 'dhruv@vishwafashions.com', role: 'employee', updated_at: new Date().toISOString() };

  // When merging datasets with same email but different local IDs, they should consolidate by email
  const merged = mergeFn('vf_users', JSON.stringify([userA]), JSON.stringify([userB]));
  assert.ok(Array.isArray(merged));
  assert.equal(merged.length, 1, 'Should reconcile users sharing the same email');
});

test('2. filterDeletedEntities prevents deleted accounts in vf_deleted_auth_users from resurrecting', () => {
  const env = setupTestEnvironment({
    vf_deleted_auth_users: JSON.stringify(['dhruv@vishwafashions.com', 'emp-legacy-999'])
  });
  const filterFn = env.VishwaSupabase.filterDeletedEntities;

  const users = [
    { id: 'emp-1', email: 'active@vishwafashions.com', role: 'employee' },
    { id: 'emp-2', email: 'dhruv@vishwafashions.com', role: 'employee' },
    { id: 'emp-legacy-999', email: 'other@vishwafashions.com', role: 'employee' }
  ];

  const filtered = filterFn(users);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].email, 'active@vishwafashions.com');
});

test('3. MASTER_ENTITY_KEYS authoritative cloud sync preserves remote employee accounts on fresh workstation', () => {
  const env = setupTestEnvironment();
  const mergeFn = env.VishwaSupabase.mergeDatasets;

  const remoteUsers = [
    { id: 'emp-1', email: 'employee1@vishwafashions.com', permissions: { 'order-book': 'edit' } },
    { id: 'emp-2', email: 'employee2@vishwafashions.com', permissions: { 'order-book': 'view' } }
  ];

  const merged = mergeFn('vf_users', '[]', JSON.stringify(remoteUsers));
  assert.equal(merged.length, 2, 'Fresh workstation must adopt all remote employee accounts');
  assert.equal(merged[0].email, 'employee1@vishwafashions.com');
  assert.equal(merged[1].email, 'employee2@vishwafashions.com');
});

test('4. Gemini API Key & Model: empty workstation adopts non-empty cloud credentials', () => {
  const env = setupTestEnvironment();
  const mergeFn = env.VishwaSupabase.mergeDatasets;

  const cloudKey = '"AIzaSyD_TestKey_12345"';
  const localEmptyKey = '""';

  const mergedKey = mergeFn('gemini-api-key', localEmptyKey, cloudKey);
  assert.equal(mergedKey, cloudKey, 'Empty local key must adopt cloud key');

  const cloudModel = '"gemini-2.5-flash"';
  const localEmptyModel = '""';
  const mergedModel = mergeFn('selected-gemini-model', localEmptyModel, cloudModel);
  assert.equal(mergedModel, cloudModel, 'Empty local model must adopt cloud model');
});

test('5. VishwaSupabase.authUsers helper exists and exposes getAll, saveUser, and deleteUser', () => {
  const env = setupTestEnvironment();
  assert.ok(env.VishwaSupabase.authUsers, 'authUsers helper must be present on VishwaSupabase');
  assert.equal(typeof env.VishwaSupabase.authUsers.getAll, 'function');
  assert.equal(typeof env.VishwaSupabase.authUsers.saveUser, 'function');
  assert.equal(typeof env.VishwaSupabase.authUsers.deleteUser, 'function');
});

test('6. VishwaSupabase.authUsers.saveUser updates local storage and deleteUser records tombstone', async () => {
  const env = setupTestEnvironment();
  const authUsers = env.VishwaSupabase.authUsers;

  // Save an employee
  const employee = {
    email: 'bi_emp@vishwafashions.com',
    name: 'Bi Employee',
    role: 'employee',
    permissions: { 'order-book': 'edit' }
  };
  await authUsers.saveUser(employee);

  const rawUsers = env.localStorage.getItem('vf_users');
  assert.ok(rawUsers, 'vf_users should be updated in localStorage');
  const users = JSON.parse(rawUsers);
  assert.ok(users.some(u => u.email === 'bi_emp@vishwafashions.com'));

  // Delete the employee
  await authUsers.deleteUser(employee.email);

  // Check tombstone added
  const rawDeleted = env.localStorage.getItem('vf_deleted_auth_users');
  assert.ok(rawDeleted, 'vf_deleted_auth_users must contain deleted email');
  const deletedList = JSON.parse(rawDeleted);
  assert.ok(deletedList.includes('bi_emp@vishwafashions.com'));

  // Check employee removed from vf_users
  const updatedUsers = JSON.parse(env.localStorage.getItem('vf_users') || '[]');
  assert.ok(!updatedUsers.some(u => u.email === 'bi_emp@vishwafashions.com'));
});

test('7. VishwaSupabase.authUsers.saveUser saves admin to vf_admin_users and updates admin cache', async () => {
  const env = setupTestEnvironment();
  const authUsers = env.VishwaSupabase.authUsers;

  const admin = {
    email: 'bi_admin@vishwafashions.com',
    name: 'Bi Admin',
    role: 'admin',
    pass_hash: 'adminhash123'
  };
  await authUsers.saveUser(admin);

  const rawAdmins = env.localStorage.getItem('vf_admin_users');
  assert.ok(rawAdmins, 'vf_admin_users should be updated in localStorage');
  const admins = JSON.parse(rawAdmins);
  assert.ok(admins.some(a => a.email === 'bi_admin@vishwafashions.com'));
});

test('8. Reconciling remote deletion from Supabase authoritatively evicts user locally', () => {
  const env = setupTestEnvironment({
    vf_users: JSON.stringify([
      { id: 'emp-1', email: 'keep@vishwafashions.com', role: 'employee' },
      { id: 'emp-2', email: 'deleted_in_cloud@vishwafashions.com', role: 'employee' }
    ])
  });
  const mergeFn = env.VishwaSupabase.mergeDatasets;

  // Cloud only has 'keep@vishwafashions.com'
  const remoteSnapshot = [
    { id: 'emp-1', email: 'keep@vishwafashions.com', role: 'employee' }
  ];

  const merged = mergeFn('vf_users', env.localStorage.getItem('vf_users'), JSON.stringify(remoteSnapshot));
  assert.equal(merged.length, 1, 'Locally cached deleted user must be evicted by cloud authority');
  assert.equal(merged[0].email, 'keep@vishwafashions.com');
});

test('9. Re-creating or saving a user clears any previous tombstone from vf_deleted_auth_users', async () => {
  const env = setupTestEnvironment({
    vf_deleted_auth_users: JSON.stringify(['reborn@vishwafashions.com'])
  });
  const authUsers = env.VishwaSupabase.authUsers;

  await authUsers.saveUser({
    email: 'reborn@vishwafashions.com',
    name: 'Reborn Employee',
    role: 'employee'
  });

  const tombstones = JSON.parse(env.localStorage.getItem('vf_deleted_auth_users') || '[]');
  assert.ok(!tombstones.includes('reborn@vishwafashions.com'), 'Tombstone must be cleared upon user re-creation');

  const users = JSON.parse(env.localStorage.getItem('vf_users') || '[]');
  assert.ok(users.some(u => u.email === 'reborn@vishwafashions.com'));
});

test('10. authUsers.getAll falls back to local storage when offline or unconfigured', async () => {
  const env = setupTestEnvironment({
    vf_admin_users: JSON.stringify([{ id: 'adm-1', email: 'adm@vishwafashions.com', role: 'admin' }]),
    vf_users: JSON.stringify([{ id: 'emp-1', email: 'emp@vishwafashions.com', role: 'employee' }])
  });

  const all = await env.VishwaSupabase.authUsers.getAll();
  assert.equal(all.length, 2);
  assert.ok(all.some(u => u.email === 'adm@vishwafashions.com'));
  assert.ok(all.some(u => u.email === 'emp@vishwafashions.com'));
});

