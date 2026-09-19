/**
 * Vishwa Atelier Management Suite — Phase 3 Auth Adapter Test Suite
 * 
 * Verifies:
 * 1. Authoritative Supabase Auth token authentication
 * 2. Explicit rejection on invalid credentials (NO silent admin fallback)
 * 3. Sanitized session storage (0 passwords or hashes in vf_session)
 * 4. Token refresh cycle via refreshSession()
 * 5. authenticatedFetch automatic 401 retry with refreshed token
 * 6. Role and permission resolution via hasPermission() and getCurrentProfile()
 * 7. Migration report generation identifying legacy SHA-256 vs modern accounts
 * 8. Strict honoring of VF_ENABLE_LOCAL_AUTH_FALLBACK rollback flag
 */

const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

function createAuthTestEnv(options = {}) {
  const store = { ...(options.initialStore || {}) };
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
    location: { pathname: '/management%20suite/index.html', href: 'http://localhost/index.html', search: '' },
    APP_CONFIG: {
      SUPABASE_URL: options.supabaseUrl !== undefined ? options.supabaseUrl : 'https://auth-test.supabase.co',
      SUPABASE_ANON_KEY: options.supabaseKey !== undefined ? options.supabaseKey : 'mock-anon-key'
    },
    VF_ENABLE_LOCAL_AUTH_FALLBACK: options.enableFallback || false,
    localStorage: localStorageMock,
    crypto: {
      subtle: {
        digest: async (algo, data) => {
          // Deterministic Node crypto mock for SHA-256
          const crypto = require('node:crypto');
          const hash = crypto.createHash('sha256').update(Buffer.from(data)).digest();
          return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
        }
      }
    },
    addEventListener(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (listeners[event]) listeners[event] = listeners[event].filter(f => f !== fn);
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
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {} }),
    body: { appendChild: () => {} }
  };

  // Mock fetch router
  const fetchMock = async (url, opts = {}) => {
    if (options.mockFetch) {
      const customRes = await options.mockFetch(url, opts);
      if (customRes !== undefined) return customRes;
    }

    // Default Supabase token auth endpoint
    if (url.includes('/auth/v1/token?grant_type=password')) {
      const body = JSON.parse(opts.body || '{}');
      if (body.email === 'valid@vishwaatelier.com' && body.password === 'CorrectPass123!') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'valid-jwt-token-xyz',
            refresh_token: 'valid-refresh-token-xyz',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id: 'usr-supabase-123',
              email: 'valid@vishwaatelier.com',
              user_metadata: {
                name: 'Valid Operator',
                role: 'employee',
                permissions: { 'yarn-rm-orders': 'edit', 'weaving-order-book': 'view' }
              }
            }
          })
        };
      } else {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'Invalid login credentials'
          })
        };
      }
    }

    // Refresh token endpoint
    if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
      const body = JSON.parse(opts.body || '{}');
      if (body.refresh_token === 'valid-refresh-token-xyz') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-jwt-token-refreshed',
            refresh_token: 'valid-refresh-token-xyz',
            expires_in: 3600
          })
        };
      }
      return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
    }

    // Logout endpoint
    if (url.includes('/auth/v1/logout')) {
      return { ok: true, status: 204 };
    }

    // KV store default
    return { ok: true, status: 200, json: async () => [] };
  };

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
    fetchMock
  );

  return {
    window: windowMock,
    localStorage: localStorageMock,
    VishwaAuth: windowMock.VishwaAuth,
    VishwaSupabase: windowMock.VishwaSupabase
  };
}

test('VishwaAuth Compatibility Layer Suite', async (t) => {

  await t.test('1. VishwaAuth is exposed globally and aliased on VishwaSupabase.auth', () => {
    const env = createAuthTestEnv();
    assert.ok(env.VishwaAuth, 'window.VishwaAuth is defined');
    assert.ok(env.VishwaSupabase.auth, 'window.VishwaSupabase.auth is defined');
    assert.strictEqual(env.VishwaAuth, env.VishwaSupabase.auth, 'VishwaAuth matches VishwaSupabase.auth');
    assert.strictEqual(typeof env.VishwaAuth.signIn, 'function');
    assert.strictEqual(typeof env.VishwaAuth.signOut, 'function');
    assert.strictEqual(typeof env.VishwaAuth.getSession, 'function');
    assert.strictEqual(typeof env.VishwaAuth.refreshSession, 'function');
    assert.strictEqual(typeof env.VishwaAuth.getCurrentProfile, 'function');
    assert.strictEqual(typeof env.VishwaAuth.hasPermission, 'function');
    assert.strictEqual(typeof env.VishwaAuth.authenticatedFetch, 'function');
    assert.strictEqual(typeof env.VishwaAuth.generateMigrationReport, 'function');
  });

  await t.test('2. Successful Supabase Auth saves session with zero passwords or hashes', async () => {
    const env = createAuthTestEnv();

    const res = await env.VishwaAuth.signIn('valid@vishwaatelier.com', 'CorrectPass123!');
    assert.strictEqual(res.error, null);
    assert.ok(res.data, 'Login returned user and session data');

    const sessionRaw = env.localStorage.getItem('vf_session');
    assert.ok(sessionRaw, 'vf_session saved in localStorage');
    const session = JSON.parse(sessionRaw);

    assert.strictEqual(session.email, 'valid@vishwaatelier.com');
    assert.strictEqual(session.role, 'employee');
    assert.strictEqual(session.access_token, 'valid-jwt-token-xyz');
    assert.strictEqual(session.refresh_token, 'valid-refresh-token-xyz');

    // STRICT NON-NEGOTIABLE: Zero passwords or password hashes in session
    assert.strictEqual(session.password, undefined, 'password must NOT exist in session');
    assert.strictEqual(session.passHash, undefined, 'passHash must NOT exist in session');
    assert.strictEqual(session.pass_hash, undefined, 'pass_hash must NOT exist in session');

    // Verify token storage
    assert.strictEqual(env.localStorage.getItem('vf_supabase_token'), 'valid-jwt-token-xyz');
  });

  await t.test('3. Rejected Supabase Auth fails explicitly without silent admin fallback', async () => {
    // Setup local storage with legacy default admin
    const env = createAuthTestEnv({
      initialStore: {
        vf_admin_users: JSON.stringify([{ email: 'admin@vishwafashions.com', passHash: 'admin123', role: 'admin' }])
      },
      enableFallback: false // Online authoritative mode
    });

    // Attempt login with wrong password against online Supabase
    const res = await env.VishwaAuth.signIn('admin@vishwafashions.com', 'wrongpassword');

    // MUST return explicit error, NOT silent success
    assert.ok(res.error, 'Rejection produces explicit error');
    assert.strictEqual(res.data, null, 'Data is null on failure');
    assert.match(res.error.message, /Invalid login credentials|Invalid email or password/);

    // Session must NOT be created
    assert.strictEqual(env.localStorage.getItem('vf_session'), null, 'No session created on invalid credentials');
  });

  await t.test('4. Token refresh cycle updates access token and active session', async () => {
    const env = createAuthTestEnv();

    // Sign in first
    await env.VishwaAuth.signIn('valid@vishwaatelier.com', 'CorrectPass123!');
    assert.strictEqual(env.localStorage.getItem('vf_supabase_token'), 'valid-jwt-token-xyz');

    // Trigger refresh
    const newToken = await env.VishwaAuth.refreshSession();
    assert.strictEqual(newToken, 'new-jwt-token-refreshed');

    // Verify localStorage tokens are updated
    assert.strictEqual(env.localStorage.getItem('vf_supabase_token'), 'new-jwt-token-refreshed');
    const updatedSess = JSON.parse(env.localStorage.getItem('vf_session'));
    assert.strictEqual(updatedSess.access_token, 'new-jwt-token-refreshed');
  });

  await t.test('5. authenticatedFetch automatically retries once on 401 with refreshed token', async () => {
    let fetchCount = 0;
    let authHeaderSent = [];

    const env = createAuthTestEnv({
      mockFetch: async (url, opts) => {
        if (url.includes('/rest/v1/vf_protected_table')) {
          fetchCount++;
          authHeaderSent.push(opts.headers?.Authorization);
          if (fetchCount === 1) {
            // First call fails with 401
            return { ok: false, status: 401, json: async () => ({ message: 'JWT expired' }) };
          }
          // Second retry call succeeds
          return { ok: true, status: 200, json: async () => [{ id: 1, name: 'Protected Item' }] };
        }
        return undefined;
      }
    });

    // Sign in
    await env.VishwaAuth.signIn('valid@vishwaatelier.com', 'CorrectPass123!');

    // Call authenticatedFetch
    const res = await env.VishwaAuth.authenticatedFetch('https://auth-test.supabase.co/rest/v1/vf_protected_table');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(fetchCount, 2, 'Fetches original, catches 401, refreshes, and retries');
    assert.strictEqual(authHeaderSent[0], 'Bearer valid-jwt-token-xyz');
    assert.strictEqual(authHeaderSent[1], 'Bearer new-jwt-token-refreshed');
  });

  await t.test('6. Role and permission resolution across Admin, Operator and Viewer', async () => {
    const env = createAuthTestEnv();

    // Test unauthenticated
    assert.strictEqual(env.VishwaAuth.getCurrentProfile(), null);
    assert.strictEqual(env.VishwaAuth.hasPermission('yarn-rm-orders'), false);

    // Test Operator login
    await env.VishwaAuth.signIn('valid@vishwaatelier.com', 'CorrectPass123!');
    const profile = env.VishwaAuth.getCurrentProfile();
    assert.strictEqual(profile.email, 'valid@vishwaatelier.com');
    assert.strictEqual(profile.role, 'employee');

    // Check operator specific permissions
    assert.strictEqual(env.VishwaAuth.hasPermission('yarn-rm-orders', 'edit'), true);
    assert.strictEqual(env.VishwaAuth.hasPermission('weaving-order-book', 'view'), true);
    assert.strictEqual(env.VishwaAuth.hasPermission('weaving-order-book', 'edit'), false);
    assert.strictEqual(env.VishwaAuth.hasPermission('salary-sheet'), false);

    // Test Admin role (wildcard)
    env.localStorage.setItem('vf_session', JSON.stringify({
      id: 'admin-1',
      email: 'admin@vishwaatelier.com',
      role: 'admin',
      permissions: '*'
    }));
    assert.strictEqual(env.VishwaAuth.hasPermission('salary-sheet', 'edit'), true);
    assert.strictEqual(env.VishwaAuth.hasPermission('any-unlisted-module'), true);
  });

  await t.test('7. signOut terminates session and purges local storage', async () => {
    const env = createAuthTestEnv();

    await env.VishwaAuth.signIn('valid@vishwaatelier.com', 'CorrectPass123!');
    assert.ok(env.localStorage.getItem('vf_session'));

    await env.VishwaAuth.signOut();

    assert.strictEqual(env.localStorage.getItem('vf_session'), null);
    assert.strictEqual(env.localStorage.getItem('vf_user_name'), null);
    assert.strictEqual(env.localStorage.getItem('vf_supabase_token'), null);
    assert.strictEqual(env.localStorage.getItem('vf_supabase_session'), null);
    assert.strictEqual(env.VishwaAuth.getSession(), null);
  });

  await t.test('8. generateMigrationReport categorizes legacy accounts and plaintext passwords', () => {
    const env = createAuthTestEnv({
      initialStore: {
        vf_admin_users: JSON.stringify([
          { email: 'admin@vishwafashions.com', passHash: 'admin123', name: 'Legacy Admin' }
        ]),
        vf_users: JSON.stringify([
          { email: 'operator@vishwafashions.com', passHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', name: 'Hashed User' },
          { email: 'weaver@vishwafashions.com', passHash: 'plainpass', name: 'Plain User' }
        ])
      }
    });

    const report = env.VishwaAuth.generateMigrationReport();
    assert.strictEqual(report.totalAccounts, 3);
    assert.strictEqual(report.plainTextUsers, 2, 'admin123 and plainpass identified as plaintext');
    assert.strictEqual(report.legacyHashedUsers, 1, '64-hex hash identified as legacy SHA-256');

    const plainAdmin = report.accounts.find(a => a.email === 'admin@vishwafashions.com');
    assert.strictEqual(plainAdmin.credentialType, 'plaintext');
    assert.strictEqual(plainAdmin.migrationAction, 'direct_auth_signup_ready');

    const hashedUser = report.accounts.find(a => a.email === 'operator@vishwafashions.com');
    assert.strictEqual(hashedUser.credentialType, 'legacy_sha256');
    assert.strictEqual(hashedUser.migrationAction, 'password_reset_or_dual_auth');
  });

  await t.test('9. Rollback flag VF_ENABLE_LOCAL_AUTH_FALLBACK honors offline fallback when enabled', async () => {
    const env = createAuthTestEnv({
      initialStore: {
        vf_admin_users: JSON.stringify([
          { email: 'localadmin@vishwaatelier.com', passHash: 'fallbackpass123', role: 'admin' }
        ])
      },
      enableFallback: true // Rollback flag enabled
    });

    assert.strictEqual(env.VishwaAuth.isLocalAuthFallbackEnabled(), true);

    // With rollback enabled, local match succeeds
    const res = await env.VishwaAuth.signIn('localadmin@vishwaatelier.com', 'fallbackpass123');
    assert.strictEqual(res.error, null);
    assert.strictEqual(res.data.session.role, 'admin');
    assert.strictEqual(res.data.session.password, undefined);
    assert.strictEqual(res.data.session.passHash, undefined);
  });
});
