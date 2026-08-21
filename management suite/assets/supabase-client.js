(function() {
  const SUPABASE_URL = "https://fwlzysudduroyndkiewa.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bHp5c3VkZHVyb3luZGtpZXdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4ODMwMDEsImV4cCI6MjEwMDQ1OTAwMX0.Cv0Ns_gslFFSe90_lu1YBqo9aEcHaUbmnsI43TDZ_oo";

  // Native browser localStorage reference before overriding
  const nativeLocalStorage = window.localStorage;

  // In-memory cache for instant synchronous reading across device sessions
  const cache = {};
  window.__vf_supabase_cache = cache;

  // Seed cache synchronously from native localStorage so page scripts have data instantly on page load
  try {
    for (let i = 0; i < nativeLocalStorage.length; i++) {
      const k = nativeLocalStorage.key(i);
      if (k) {
        cache[k] = nativeLocalStorage.getItem(k);
      }
    }
  } catch (e) {}

  // Track last local writes to prevent polling race conditions from overwriting active user edits
  const lastLocalWrites = {};

  // BroadcastChannel for instant real-time sync across open windows in the same browser
  const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('vf_supabase_sync') : null;

  if (syncChannel) {
    syncChannel.onmessage = (msg) => {
      if (msg && msg.data && msg.data.key) {
        const { key, value, type } = msg.data;
        if (type === 'removeItem') {
          delete cache[key];
          try { nativeLocalStorage.removeItem(key); } catch(e) {}
          window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key, value: null } }));
          try {
            window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: null }));
          } catch(e) {
            window.dispatchEvent(new Event('storage'));
          }
        } else {
          if (cache[key] !== value) {
            cache[key] = value;
            try { nativeLocalStorage.setItem(key, value); } catch(e) {}
            window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key, value } }));
            try {
              window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: value }));
            } catch(e) {
              window.dispatchEvent(new Event('storage'));
            }
          }
        }
      }
    };
  }

  // Track last known server timestamps to avoid re-downloading unchanged payloads
  const lastKnownTimestamps = {};

  // Supabase REST API Client
  const supabaseApi = {
    async get(key) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=eq.${encodeURIComponent(key)}&select=value`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data && data.length > 0 ? data[0].value : null;
      } catch (e) {
        console.error('Supabase fetch error:', e);
        return null;
      }
    },
    async set(key, value) {
      try {
        const nowIso = new Date().toISOString();
        lastKnownTimestamps[key] = nowIso;

        // Master Key-Value table sync with on_conflict=key for proper PostgREST upsert
        fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?on_conflict=key`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            key: key,
            value: value,
            updated_at: nowIso
          })
        }).catch(() => {});

        // Dual-write to dedicated Costing Sheet tables if matching costing key
        let table = null;
        if (key === 'costing-products-v4') table = 'vf_costing_products';
        else if (key === 'costing-tfo-products-v1') table = 'vf_costing_tfo_products';
        else if (key === 'costing-doubler-products-v1') table = 'vf_costing_doubler_products';
        else if (key === 'costing-covering-products-v1') table = 'vf_costing_covering_products';

        if (table && Array.isArray(value)) {
          value.forEach(item => {
            if (item && item.id) {
              fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
                method: 'POST',
                headers: {
                  'apikey': SUPABASE_ANON_KEY,
                  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify({
                  id: String(item.id),
                  data: item,
                  updated_at: nowIso
                })
              }).catch(() => {});
            }
          });
        }
        return true;
      } catch (e) {
        console.error('Supabase set error:', e);
        return false;
      }
    },
    async delete(key) {
      try {
        delete lastKnownTimestamps[key];
        await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=eq.${encodeURIComponent(key)}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
      } catch(e) {}
    },
    async clearAll() {
      try {
        Object.keys(lastKnownTimestamps).forEach(k => delete lastKnownTimestamps[k]);
        await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=neq.null`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        const tables = ['vf_costing_products', 'vf_costing_tfo_products', 'vf_costing_doubler_products', 'vf_costing_covering_products'];
        for (const t of tables) {
          fetch(`${SUPABASE_URL}/rest/v1/${t}?id=neq.null`, {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          }).catch(() => {});
        }
      } catch(e) {}
    },
    // --- Supabase Authentication API Integration ---
    async signUp(email, password, metadata = {}) {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: email,
            password: password,
            data: metadata
          })
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: new Error(data.error_description || data.msg || data.message || 'Sign up failed') };
        }
        return { data: data, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    },
    async signIn(email, password) {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: email,
            password: password
          })
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: new Error(data.error_description || data.msg || data.message || 'Invalid login credentials') };
        }
        
        // Save session locally
        if (data.access_token) {
          const user = data.user || {};
          const sessionPayload = {
            id: user.id || ('sp-' + Date.now()),
            email: user.email || email,
            username: (user.user_metadata && user.user_metadata.full_name) || (user.email ? user.email.split('@')[0] : email),
            name: (user.user_metadata && user.user_metadata.full_name) || (user.email ? user.email.split('@')[0] : 'User'),
            role: (user.user_metadata && user.user_metadata.role) || 'employee',
            permissions: (user.user_metadata && user.user_metadata.permissions) || '*',
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 3600)),
            supabase_user: user
          };
          
          try {
            nativeLocalStorage.setItem('vf_session', JSON.stringify(sessionPayload));
            nativeLocalStorage.setItem('vf_user_name', sessionPayload.username);
            nativeLocalStorage.setItem('vf_supabase_token', data.access_token);
            nativeLocalStorage.setItem('vf_supabase_session', JSON.stringify(data));
          } catch(e) {}
          
          cache['vf_session'] = JSON.stringify(sessionPayload);
          cache['vf_user_name'] = sessionPayload.username;
        }
        
        return { data: data, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    },
    async signOut() {
      try {
        let token = null;
        try { token = nativeLocalStorage.getItem('vf_supabase_token'); } catch(e) {}
        if (token) {
          fetch(`${SUPABASE_URL}/auth/v1/logout`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${token}`
            }
          }).catch(() => {});
        }
      } catch(e) {}
      
      try {
        nativeLocalStorage.removeItem('vf_session');
        nativeLocalStorage.removeItem('vf_user_name');
        nativeLocalStorage.removeItem('vf_supabase_token');
        nativeLocalStorage.removeItem('vf_supabase_session');
      } catch(e) {}
      
      delete cache['vf_session'];
      delete cache['vf_user_name'];
      return { error: null };
    },
    async getUser(accessToken) {
      try {
        const token = accessToken || nativeLocalStorage.getItem('vf_supabase_token');
        if (!token) return { data: { user: null }, error: new Error('No active token') };
        
        const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await res.json();
        if (!res.ok) return { data: { user: null }, error: new Error(data.message || 'Failed to fetch user') };
        return { data: { user: data }, error: null };
      } catch (e) {
        return { data: { user: null }, error: e };
      }
    },
    getSession() {
      try {
        const sessRaw = nativeLocalStorage.getItem('vf_session');
        return sessRaw ? JSON.parse(sessRaw) : null;
      } catch(e) {
        return null;
      }
    },
    async loadAll(isInitial = false) {
      try {
        // Optimization: On initial load, fetch full dataset once. On subsequent polls, check timestamps first.
        if (isInitial || Object.keys(lastKnownTimestamps).length === 0) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?select=key,value,updated_at`, {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          });
          if (res.ok) {
            const rows = await res.json();
            let hasChanges = false;
            const updatedKeys = [];
            rows.forEach(row => {
              try {
                if (row.updated_at) lastKnownTimestamps[row.key] = row.updated_at;
                const strValue = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
                const lastWrite = lastLocalWrites[row.key] || 0;
                if (Date.now() - lastWrite < 3000) return;

                if (cache[row.key] !== strValue) {
                  cache[row.key] = strValue;
                  try { nativeLocalStorage.setItem(row.key, strValue); } catch(e) {}
                  updatedKeys.push(row.key);
                  hasChanges = true;
                }
              } catch (e) {
                cache[row.key] = String(row.value);
              }
            });
            if (hasChanges) {
              window.dispatchEvent(new Event('storage'));
              updatedKeys.forEach(k => {
                window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: k, value: cache[k] } }));
                try {
                  window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: cache[k] }));
                } catch(e) {}
              });
            }
          }
          return;
        }

        // Lightweight Polling: Fetch ONLY key and updated_at metadata (bytes instead of megabytes)
        const metaRes = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?select=key,updated_at`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (!metaRes.ok) return;
        const metaRows = await metaRes.json();

        // Identify keys that have actually changed on the server
        const changedKeys = [];
        metaRows.forEach(row => {
          const lastWrite = lastLocalWrites[row.key] || 0;
          if (Date.now() - lastWrite < 3000) return; // Skip keys edited locally recently

          const knownTs = lastKnownTimestamps[row.key];
          if (!knownTs || !row.updated_at || row.updated_at !== knownTs || !cache.hasOwnProperty(row.key)) {
            changedKeys.push(row.key);
          }
        });

        if (changedKeys.length === 0) return; // Zero network payload downloaded if nothing changed!

        // Fetch values ONLY for changed keys
        const encodedKeys = changedKeys.map(k => `"${encodeURIComponent(k)}"`).join(',');
        const valRes = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=in.(${encodedKeys})&select=key,value,updated_at`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (valRes.ok) {
          const rows = await valRes.json();
          let hasChanges = false;
          const updatedKeys = [];
          rows.forEach(row => {
            try {
              if (row.updated_at) lastKnownTimestamps[row.key] = row.updated_at;
              const strValue = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
              if (cache[row.key] !== strValue) {
                cache[row.key] = strValue;
                try { nativeLocalStorage.setItem(row.key, strValue); } catch(e) {}
                updatedKeys.push(row.key);
                hasChanges = true;
              }
            } catch (e) {
              cache[row.key] = String(row.value);
            }
          });
          if (hasChanges) {
            window.dispatchEvent(new Event('storage'));
            updatedKeys.forEach(k => {
              window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: k, value: cache[k] } }));
              try {
                window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: cache[k] }));
              } catch(e) {}
            });
          }
        }
      } catch (e) {
        console.error('Supabase loadAll failed:', e);
      }
    }
  };

  // Initial full cloud dataset fetch on boot
  supabaseApi.loadAll(true).then(() => {
    console.log("Vishwa Fashions — Cloud Supabase sync active (egress optimized).");
  });

  // Smart polling interval & Visibility Throttling (30s interval, disabled when tab is hidden)
  let syncIntervalId = null;
  const POLL_INTERVAL_MS = 30000;

  function startSmartSync() {
    if (!syncIntervalId) {
      syncIntervalId = setInterval(() => {
        if (!document.hidden) {
          supabaseApi.loadAll(false);
        }
      }, POLL_INTERVAL_MS);
    }
  }

  function stopSmartSync() {
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  }

  startSmartSync();

  // Listen for tab focus/visibility changes to resume polling immediately
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopSmartSync();
    } else {
      supabaseApi.loadAll(false);
      startSmartSync();
    }
  });

  window.addEventListener('focus', () => {
    if (!document.hidden) {
      supabaseApi.loadAll(false);
    }
  });

  // Override localStorage calls to point to Cloud Storage with synchronous native fallback
  const supabaseLocalStorage = {
    getItem: function(key) {
      if (cache.hasOwnProperty(key)) {
        return cache[key];
      }
      try {
        const nativeVal = nativeLocalStorage.getItem(key);
        if (nativeVal !== null) {
          cache[key] = nativeVal;
          return nativeVal;
        }
      } catch(e) {}
      return null;
    },
    setItem: function(key, value) {
      const valStr = String(value);
      cache[key] = valStr;
      lastLocalWrites[key] = Date.now();
      try {
        nativeLocalStorage.setItem(key, valStr);
      } catch(e) {}

      if (syncChannel) {
        try { syncChannel.postMessage({ key: key, value: valStr, type: 'setItem' }); } catch(e) {}
      }

      let parsedVal = valStr;
      try {
        if ((valStr.startsWith('{') && valStr.endsWith('}')) || (valStr.startsWith('[') && valStr.endsWith(']'))) {
          parsedVal = JSON.parse(valStr);
        }
      } catch(e) {}

      supabaseApi.set(key, parsedVal);
    },
    removeItem: function(key) {
      delete cache[key];
      lastLocalWrites[key] = Date.now();
      try { nativeLocalStorage.removeItem(key); } catch(e) {}
      if (syncChannel) {
        try { syncChannel.postMessage({ key: key, value: null, type: 'removeItem' }); } catch(e) {}
      }
      supabaseApi.delete(key);
    },
    clear: function() {
      Object.keys(cache).forEach(k => delete cache[k]);
      try { nativeLocalStorage.clear(); } catch(e) {}
      supabaseApi.clearAll();
    },
    key: function(index) {
      return Object.keys(cache)[index] || null;
    },
    get length() {
      return Object.keys(cache).length;
    }
  };

  window.VishwaSupabase = supabaseApi;

  try {
    Object.defineProperty(window, 'localStorage', {
      value: supabaseLocalStorage,
      writable: true,
      configurable: true
    });
  } catch(e) {
    window.localStorage = supabaseLocalStorage;
  }
})();
