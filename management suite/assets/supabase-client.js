(function() {
  // Native browser localStorage reference before overriding
  const nativeLocalStorage = window.localStorage;

  // Resolve Supabase configuration dynamically:
  // 1. LocalStorage overrides (configured via Admin Settings in UI)
  // 2. Global window.APP_CONFIG (from assets/config.js)
  // 3. Fallback to unconfigured state
  function resolveConfig() {
    let url = '';
    let key = '';
    let source = 'none';

    try {
      const customUrl = nativeLocalStorage.getItem('vf_supabase_url');
      const customKey = nativeLocalStorage.getItem('vf_supabase_anon_key');
      if (customUrl && customKey && customUrl.trim() && customKey.trim()) {
        url = customUrl.trim();
        key = customKey.trim();
        source = 'localStorage';
      }
    } catch(e) {}

    if (!url && typeof window !== 'undefined' && window.APP_CONFIG) {
      if (window.APP_CONFIG.SUPABASE_URL && window.APP_CONFIG.SUPABASE_ANON_KEY) {
        url = (window.APP_CONFIG.SUPABASE_URL || '').trim();
        key = (window.APP_CONFIG.SUPABASE_ANON_KEY || '').trim();
        source = 'config.js';
      }
    }

    if (url && url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }

    const isPlaceholder = !url || !key || url.includes('your-project') || key.includes('your-anon');

    return {
      url: isPlaceholder ? '' : url,
      anonKey: isPlaceholder ? '' : key,
      isConfigured: !isPlaceholder && Boolean(url && key),
      source: source
    };
  }

  let activeConfig = resolveConfig();
  let SUPABASE_URL = activeConfig.url;
  let SUPABASE_ANON_KEY = activeConfig.anonKey;

  // Unique client session instance ID
  const CLIENT_ID = 'vf_client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();

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

  // Track last local writes to prevent race conditions from overwriting active user edits
  const lastLocalWrites = {};
  const lastSavedHashes = {};
  const debouncedWriteTimers = {};
  const pendingRemoteUpdates = {};
  const deferredApplyTimers = {};

  const COSTING_KEYS = [
    'costing-products-v4',
    'costing-tfo-products-v1',
    'costing-doubler-products-v1',
    'costing-covering-products-v1'
  ];

  let isHydrated = false;

  // Track connection status
  let currentStatus = activeConfig.isConfigured ? 'connecting' : 'unconfigured'; // 'connecting' | 'connected' | 'syncing' | 'offline' | 'unconfigured'

  function setSyncStatus(status) {
    if (currentStatus !== status) {
      currentStatus = status;
      try {
        window.dispatchEvent(new CustomEvent('supabase-status', { detail: { status: status, config: activeConfig } }));
      } catch (e) {}
    }
  }

  // BroadcastChannel for instant real-time sync across open windows in the SAME browser
  const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('vf_supabase_sync') : null;

  function applyRemoteKeyUpdate(key, valStr) {
    if (cache[key] !== valStr) {
      cache[key] = valStr;
      try { nativeLocalStorage.setItem(key, valStr); } catch(e) {}
      lastSavedHashes[key] = computeHash(valStr);
      lastKnownTimestamps[key] = new Date().toISOString();

      window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key, value: valStr, isRemote: true } }));
      try {
        window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: valStr }));
      } catch(e) {
        window.dispatchEvent(new Event('storage'));
      }
    }
  }

  function handleIncomingRemoteUpdate(key, valStr, isDelete = false) {
    if (isDelete) {
      delete cache[key];
      delete lastKnownTimestamps[key];
      delete lastSavedHashes[key];
      delete pendingRemoteUpdates[key];
      try { nativeLocalStorage.removeItem(key); } catch(e) {}
      window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key, value: null, isRemote: true } }));
      try {
        window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: null }));
      } catch(e) {
        window.dispatchEvent(new Event('storage'));
      }
      return;
    }

    const lastWrite = lastLocalWrites[key] || 0;
    const timeSinceLastWrite = Date.now() - lastWrite;

    if (timeSinceLastWrite < 3000) {
      // User is actively editing this key locally. Defer application instead of dropping!
      pendingRemoteUpdates[key] = valStr;
      clearTimeout(deferredApplyTimers[key]);
      deferredApplyTimers[key] = setTimeout(() => {
        const currentElapsed = Date.now() - (lastLocalWrites[key] || 0);
        if (currentElapsed >= 3000 && pendingRemoteUpdates[key]) {
          const deferredVal = pendingRemoteUpdates[key];
          delete pendingRemoteUpdates[key];
          applyRemoteKeyUpdate(key, deferredVal);
        }
      }, (3000 - timeSinceLastWrite) + 150);
      return;
    }

    applyRemoteKeyUpdate(key, valStr);
  }

  if (syncChannel) {
    syncChannel.onmessage = (msg) => {
      if (msg && msg.data && msg.data.key) {
        const { key, value, type, senderId } = msg.data;
        if (senderId === CLIENT_ID) return; // Skip own messages

        if (type === 'removeItem') {
          handleIncomingRemoteUpdate(key, null, true);
        } else {
          handleIncomingRemoteUpdate(key, value, false);
        }
      }
    };
  }

  // --- Realtime WebSocket Synchronization Engine (Google Sheets Style) ---
  // Zero Database Egress: Uses Phoenix Broadcast channel in Supabase server RAM
  let ws = null;
  let wsHeartbeatTimer = null;
  let wsReconnectTimer = null;
  let wsReconnectAttempts = 0;
  const WS_CHANNEL_TOPIC = 'realtime:vf_costing_sync';

  function initRealtimeWebSocket() {
    if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setSyncStatus('unconfigured');
      return;
    }
    if (typeof WebSocket === 'undefined') return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      const cleanHost = SUPABASE_URL.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      const wsUrl = `wss://${cleanHost}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        wsReconnectAttempts = 0;
        setSyncStatus('connected');

        // Join the Realtime Broadcast channel
        const joinMsg = {
          topic: WS_CHANNEL_TOPIC,
          event: 'phx_join',
          payload: { config: { broadcast: { ack: false, self: false } } },
          ref: 'join_' + Date.now()
        };
        ws.send(JSON.stringify(joinMsg));

        // Start heartbeat ping every 25 seconds
        clearInterval(wsHeartbeatTimer);
        wsHeartbeatTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb_' + Date.now() }));
          }
        }, 25000);
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.event === 'broadcast' && data.payload) {
            const inner = data.payload.payload || data.payload;
            if (inner && inner.senderId !== CLIENT_ID && inner.key) {
              const { key, value } = inner;
              const valStr = typeof value === 'string' ? value : JSON.stringify(value);
              handleIncomingRemoteUpdate(key, valStr, false);
            }
          }
        } catch (err) {}
      };

      ws.onclose = () => {
        if (activeConfig.isConfigured) {
          setSyncStatus('offline');
          clearInterval(wsHeartbeatTimer);
          scheduleWsReconnect();
        }
      };

      ws.onerror = () => {
        if (activeConfig.isConfigured) {
          setSyncStatus('offline');
          try { ws.close(); } catch(e) {}
        }
      };
    } catch (e) {
      if (activeConfig.isConfigured) {
        scheduleWsReconnect();
      }
    }
  }

  function scheduleWsReconnect() {
    clearTimeout(wsReconnectTimer);
    const delay = Math.min(30000, 1000 * Math.pow(1.5, wsReconnectAttempts++));
    wsReconnectTimer = setTimeout(() => {
      if (!document.hidden) {
        initRealtimeWebSocket();
      }
    }, delay);
  }

  function broadcastRealtimeUpdate(key, value) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const broadcastMsg = {
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: 'costing_sync',
            payload: {
              key: key,
              value: value,
              senderId: CLIENT_ID,
              timestamp: Date.now()
            }
          },
          ref: 'bc_' + Date.now()
        };
        ws.send(JSON.stringify(broadcastMsg));
      } catch (e) {}
    }
  }

  // Track last known server timestamps to avoid re-downloading unchanged payloads
  const lastKnownTimestamps = {};

  // Simple string hash function for quick payload equality check
  function computeHash(str) {
    if (!str) return '0';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  }

  // --- Infinite Scale Paginated PostgREST Fetcher ---
  // Chunked batch queries bypass default 1,000-row PostgREST limits for arbitrary dataset sizes
  async function fetchAllRowsPaginated(tableOrPath, select = '*', extraParams = '') {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
    const pageSize = 1000;
    let offset = 0;
    let allRows = [];
    let hasMore = true;

    while (hasMore) {
      try {
        const separator = tableOrPath.includes('?') ? '&' : '?';
        const url = `${SUPABASE_URL}/rest/v1/${tableOrPath}${separator}select=${encodeURIComponent(select)}&limit=${pageSize}&offset=${offset}${extraParams ? ('&' + extraParams) : ''}`;
        const res = await fetch(url, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (!res.ok) break;
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        allRows = allRows.concat(rows);
        if (rows.length < pageSize) {
          hasMore = false;
        } else {
          offset += pageSize;
        }
      } catch (e) {
        console.warn('Pagination fetch notice:', e);
        break;
      }
    }
    return allRows;
  }

  // Supabase REST API Client
  const supabaseApi = {
    isHydrated: () => isHydrated,
    getStatus: () => currentStatus,
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
    // Debounced and Hash-Guarded Persistent Database Write (Zero Wasted POST Quota)
    set(key, value, isImmediate = false) {
      try {
        lastLocalWrites[key] = Date.now();

        const nowIso = new Date().toISOString();
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        const payloadHash = computeHash(valStr);

        // Check if unchanged to avoid redundant database writes
        if (lastSavedHashes[key] === payloadHash) {
          return true;
        }

        // Broadcast immediately over Realtime WebSocket & BroadcastChannel (instant sub-50ms sync, 0 DB queries)
        broadcastRealtimeUpdate(key, value);

        const executeDbWrite = async () => {
          if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
          try {
            setSyncStatus('syncing');
            lastKnownTimestamps[key] = nowIso;
            lastSavedHashes[key] = payloadHash;

            // Master Key-Value table sync
            await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?on_conflict=key`, {
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
            });

            // Dedicated table writes if costing key
            let table = null;
            if (key === 'costing-products-v4') table = 'vf_costing_products';
            else if (key === 'costing-tfo-products-v1') table = 'vf_costing_tfo_products';
            else if (key === 'costing-doubler-products-v1') table = 'vf_costing_doubler_products';
            else if (key === 'costing-covering-products-v1') table = 'vf_costing_covering_products';

            if (table && Array.isArray(value) && value.length > 0) {
              const rows = value.filter(item => item && item.id).map(item => ({
                id: String(item.id),
                data: item,
                updated_at: nowIso
              }));

              if (rows.length > 0) {
                // Batch in chunks of 500 for safety against large payloads
                const chunkSize = 500;
                for (let i = 0; i < rows.length; i += chunkSize) {
                  const chunk = rows.slice(i, i + chunkSize);
                  await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
                    method: 'POST',
                    headers: {
                      'apikey': SUPABASE_ANON_KEY,
                      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                      'Content-Type': 'application/json',
                      'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify(chunk)
                  }).catch(() => {});
                }
              }
            }
            setSyncStatus(ws && ws.readyState === WebSocket.OPEN ? 'connected' : 'offline');
          } catch (err) {
            console.error('Supabase set error:', err);
            setSyncStatus('offline');
          }
        };

        if (isImmediate) {
          executeDbWrite();
        } else {
          clearTimeout(debouncedWriteTimers[key]);
          debouncedWriteTimers[key] = setTimeout(executeDbWrite, 1200);
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
        delete lastSavedHashes[key];
        delete pendingRemoteUpdates[key];
        if (activeConfig.isConfigured && SUPABASE_URL) {
          await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=eq.${encodeURIComponent(key)}`, {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          });
        }
      } catch(e) {}
    },
    // Explicit Item Deletion Tombstone Tracking
    async recordCostingDeletion(key, itemId) {
      try {
        const idStr = String(itemId);
        let deletedIds = [];
        try {
          const raw = cache['vf_deleted_costing_ids'] || nativeLocalStorage.getItem('vf_deleted_costing_ids');
          if (raw) deletedIds = JSON.parse(raw);
        } catch (e) {}

        if (!deletedIds.includes(idStr)) {
          deletedIds.push(idStr);
          // Prune tombstone array to most recent 2000 items to avoid memory leaks
          if (deletedIds.length > 2000) {
            deletedIds = deletedIds.slice(-2000);
          }
          const valStr = JSON.stringify(deletedIds);
          cache['vf_deleted_costing_ids'] = valStr;
          try { nativeLocalStorage.setItem('vf_deleted_costing_ids', valStr); } catch(e) {}
          this.set('vf_deleted_costing_ids', deletedIds, true);
        }

        // Delete from dedicated table
        let table = null;
        if (key === 'costing-products-v4') table = 'vf_costing_products';
        else if (key === 'costing-tfo-products-v1') table = 'vf_costing_tfo_products';
        else if (key === 'costing-doubler-products-v1') table = 'vf_costing_doubler_products';
        else if (key === 'costing-covering-products-v1') table = 'vf_costing_covering_products';

        if (table && activeConfig.isConfigured && SUPABASE_URL) {
          fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(idStr)}`, {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          }).catch(() => {});
        }
      } catch (e) {}
    },
    async clearAll() {
      try {
        Object.keys(lastKnownTimestamps).forEach(k => delete lastKnownTimestamps[k]);
        if (activeConfig.isConfigured && SUPABASE_URL) {
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
        if (token && SUPABASE_URL) {
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
    // Dynamic Configuration & Diagnostic APIs
    getConfig: () => ({
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      isConfigured: activeConfig.isConfigured,
      source: activeConfig.source
    }),
    async testConnection(testUrl, testKey) {
      const url = (testUrl || SUPABASE_URL || '').replace(/\/+$/, '');
      const key = testKey || SUPABASE_ANON_KEY || '';
      if (!url || !key) {
        return { ok: false, message: 'URL and Anon Key are required.' };
      }
      try {
        const cleanHost = url.replace(/^https?:\/\//i, '');
        const res = await fetch(`${url}/rest/v1/vf_kv_store?select=key&limit=1`, {
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`
          }
        });
        if (res.ok) {
          return { ok: true, message: 'Connected successfully to Supabase!' };
        } else {
          const err = await res.json().catch(() => ({}));
          return { ok: false, message: err.message || `Server returned error ${res.status}: ${res.statusText}` };
        }
      } catch (e) {
        return { ok: false, message: `Connection failed: ${e.message || e}` };
      }
    },
    async configure({ url, anonKey, saveToStorage = true }) {
      if (saveToStorage) {
        try {
          if (url && anonKey) {
            nativeLocalStorage.setItem('vf_supabase_url', url.trim());
            nativeLocalStorage.setItem('vf_supabase_anon_key', anonKey.trim());
          } else {
            nativeLocalStorage.removeItem('vf_supabase_url');
            nativeLocalStorage.removeItem('vf_supabase_anon_key');
          }
        } catch(e) {}
      }

      activeConfig = resolveConfig();
      if (url && anonKey && !saveToStorage) {
        activeConfig = {
          url: url.trim().replace(/\/+$/, ''),
          anonKey: anonKey.trim(),
          isConfigured: true,
          source: 'direct'
        };
      }
      SUPABASE_URL = activeConfig.url;
      SUPABASE_ANON_KEY = activeConfig.anonKey;

      if (ws) {
        try { ws.close(); } catch(e) {}
        ws = null;
      }
      clearInterval(wsHeartbeatTimer);
      clearTimeout(wsReconnectTimer);

      if (activeConfig.isConfigured) {
        setSyncStatus('connecting');
        initRealtimeWebSocket();
        await this.loadAll(true);
      } else {
        setSyncStatus('unconfigured');
      }

      return activeConfig;
    },
    resetConfig() {
      try {
        nativeLocalStorage.removeItem('vf_supabase_url');
        nativeLocalStorage.removeItem('vf_supabase_anon_key');
      } catch(e) {}
      return this.configure({ url: null, anonKey: null, saveToStorage: false });
    },
    // --- Cloud-First Hydration & Intelligent Item Merge Engine ---
    async loadAll(isInitial = false) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
        isHydrated = true;
        setSyncStatus('unconfigured');
        window.dispatchEvent(new CustomEvent('supabase-ready', { detail: { isReady: true, keys: [] } }));
        return;
      }
      try {
        if (isInitial || Object.keys(lastKnownTimestamps).length === 0) {
          const rows = await fetchAllRowsPaginated('vf_kv_store', 'key,value,updated_at');
          if (Array.isArray(rows)) {
            let hasChanges = false;
            const updatedKeys = [];
            const kvMap = {};

            rows.forEach(row => {
              try {
                if (row.updated_at) lastKnownTimestamps[row.key] = row.updated_at;
                const strValue = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
                kvMap[row.key] = row.value;
                lastSavedHashes[row.key] = computeHash(strValue);

                const lastWrite = lastLocalWrites[row.key] || 0;
                if (Date.now() - lastWrite < 3000) {
                  pendingRemoteUpdates[row.key] = strValue;
                  return;
                }

                if (cache[row.key] !== strValue || isInitial) {
                  cache[row.key] = strValue;
                  try { nativeLocalStorage.setItem(row.key, strValue); } catch(e) {}
                  updatedKeys.push(row.key);
                  hasChanges = true;
                }
              } catch (e) {
                cache[row.key] = String(row.value);
              }
            });

            // Reconcile Dedicated Costing Tables for complete data safety (Paginated)
            try {
              const costingTableDefs = [
                { key: 'costing-products-v4', table: 'vf_costing_products' },
                { key: 'costing-tfo-products-v1', table: 'vf_costing_tfo_products' },
                { key: 'costing-doubler-products-v1', table: 'vf_costing_doubler_products' },
                { key: 'costing-covering-products-v1', table: 'vf_costing_covering_products' }
              ];

              let deletedCostingIds = [];
              try {
                const delRow = kvMap['vf_deleted_costing_ids'];
                if (delRow) {
                  deletedCostingIds = typeof delRow === 'string' ? JSON.parse(delRow) : delRow;
                }
              } catch (e) {}

              for (const { key, table } of costingTableDefs) {
                const tblRows = await fetchAllRowsPaginated(table, 'id,data,updated_at');

                if (Array.isArray(tblRows) && tblRows.length > 0) {
                  let currentKvArray = [];
                  try {
                    const existing = kvMap[key];
                    if (existing) currentKvArray = typeof existing === 'string' ? JSON.parse(existing) : existing;
                  } catch(e) {}

                  const mergedMap = new Map();
                  // Load table items (authoritative server items)
                  tblRows.forEach(r => {
                    const idStr = String(r.data?.id || r.id);
                    if (r.data && !deletedCostingIds.includes(idStr)) {
                      mergedMap.set(idStr, r.data);
                    }
                  });
                  // Merge cloud kvMap items only if not deleted and not in table
                  if (Array.isArray(currentKvArray)) {
                    currentKvArray.forEach(item => {
                      if (item && item.id) {
                        const idStr = String(item.id);
                        if (!deletedCostingIds.includes(idStr) && !mergedMap.has(idStr)) {
                          mergedMap.set(idStr, item);
                        }
                      }
                    });
                  }

                  const mergedList = Array.from(mergedMap.values());
                  const mergedStr = JSON.stringify(mergedList);

                  const lastTableWrite = lastLocalWrites[key] || 0;
                  if (Date.now() - lastTableWrite >= 3000 && mergedList.length > 0) {
                    cache[key] = mergedStr;
                    lastSavedHashes[key] = computeHash(mergedStr);
                    try { nativeLocalStorage.setItem(key, mergedStr); } catch(e) {}
                    if (!updatedKeys.includes(key)) updatedKeys.push(key);
                    hasChanges = true;
                  }
                }
              }
            } catch (err) {
              console.warn('Dedicated tables reconciliation notice:', err);
            }

            isHydrated = true;
            window.dispatchEvent(new CustomEvent('supabase-ready', { detail: { isReady: true, keys: updatedKeys } }));

            if (hasChanges || isInitial) {
              window.dispatchEvent(new Event('storage'));
              updatedKeys.forEach(k => {
                window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: k, value: cache[k], isRemote: true } }));
                try {
                  window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: cache[k] }));
                } catch(e) {}
              });
            }
          }
          return;
        }

        // Lightweight Polling: Fetch metadata with pagination for complete coverage
        const metaRows = await fetchAllRowsPaginated('vf_kv_store', 'key,updated_at');
        if (!Array.isArray(metaRows) || metaRows.length === 0) return;

        // Identify keys that have actually changed on the server
        const changedKeys = [];
        metaRows.forEach(row => {
          const lastWrite = lastLocalWrites[row.key] || 0;
          const knownTs = lastKnownTimestamps[row.key];
          if (!knownTs || !row.updated_at || row.updated_at !== knownTs || !cache.hasOwnProperty(row.key)) {
            if (Date.now() - lastWrite >= 3000) {
              changedKeys.push(row.key);
            }
          }
        });

        if (changedKeys.length === 0) return; // Zero network payload downloaded if nothing changed!

        // Fetch values in chunks of 50 keys to prevent URL overflow
        const chunkSize = 50;
        let hasChanges = false;
        const updatedKeys = [];

        for (let i = 0; i < changedKeys.length; i += chunkSize) {
          const chunk = changedKeys.slice(i, i + chunkSize);
          const encodedKeys = chunk.map(k => `"${encodeURIComponent(k)}"`).join(',');
          const valRes = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=in.(${encodedKeys})&select=key,value,updated_at`, {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          });
          if (valRes.ok) {
            const rows = await valRes.json();
            rows.forEach(row => {
              try {
                if (row.updated_at) lastKnownTimestamps[row.key] = row.updated_at;
                const strValue = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
                lastSavedHashes[row.key] = computeHash(strValue);

                const lastWrite = lastLocalWrites[row.key] || 0;
                if (Date.now() - lastWrite < 3000) {
                  pendingRemoteUpdates[row.key] = strValue;
                  return;
                }

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
          }
        }

        if (hasChanges) {
          window.dispatchEvent(new Event('storage'));
          updatedKeys.forEach(k => {
            window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: k, value: cache[k], isRemote: true } }));
            try {
              window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: cache[k] }));
            } catch(e) {}
          });
        }
      } catch (e) {
        console.error('Supabase loadAll failed:', e);
      } finally {
        isHydrated = true;
      }
    }
  };

  // Initial boot: start Realtime WS and initial load
  if (activeConfig.isConfigured) {
    initRealtimeWebSocket();
    supabaseApi.loadAll(true).then(() => {
      console.log("Management Suite — Cloud Sync initialized.");
    });
  } else {
    // Self-healing: if APP_CONFIG loads after supabase-client.js, auto-configure
    let checkAttempts = 0;
    const configCheckTimer = setInterval(() => {
      checkAttempts++;
      if (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL && window.APP_CONFIG.SUPABASE_ANON_KEY) {
        clearInterval(configCheckTimer);
        const resolved = resolveConfig();
        if (resolved.isConfigured && !activeConfig.isConfigured) {
          supabaseApi.configure({ url: resolved.url, anonKey: resolved.anonKey, saveToStorage: false });
        }
      }
      if (checkAttempts > 20) {
        clearInterval(configCheckTimer);
      }
    }, 250);
  }

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

  // Listen for tab focus/visibility changes to resume polling & reconnect WebSocket immediately
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopSmartSync();
    } else {
      initRealtimeWebSocket();
      supabaseApi.loadAll(false);
      startSmartSync();
    }
  });

  window.addEventListener('focus', () => {
    if (!document.hidden) {
      initRealtimeWebSocket();
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
        try { syncChannel.postMessage({ key: key, value: valStr, type: 'setItem', senderId: CLIENT_ID }); } catch(e) {}
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
        try { syncChannel.postMessage({ key: key, value: null, type: 'removeItem', senderId: CLIENT_ID }); } catch(e) {}
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
