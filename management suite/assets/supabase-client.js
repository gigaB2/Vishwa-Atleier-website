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

  // Local-only keys that must NEVER sync across different computers/users in the cloud database
  const LOCAL_ONLY_KEYS = new Set([
    'vf_session',
    'vf_user_name',
    'vf_supabase_token',
    'vf_supabase_session',
    'vf_supabase_url',
    'vf_supabase_anon_key',
    'vf_sidebar_open_folders',
    'vf_sidebar_collapsed',
    'vishwa_fashions_sidebar_mode',
    'vishwa_fashions_theme'
  ]);

  function isLocalOnlyKey(key) {
    if (!key || typeof key !== 'string') return true;
    if (LOCAL_ONLY_KEYS.has(key)) return true;
    if (key.startsWith('user_theme_') || key.startsWith('vf_device_') || key.startsWith('vf_local_')) {
      return true;
    }
    return false;
  }

  // --- IndexedDB Safe Storage Fallback (Protects against 5MB QuotaExceededError crashes) ---
  const IDB_NAME = 'vf_management_suite_db';
  const IDB_STORE = 'vf_keyval';
  let idbInstance = null;

  function getIDB() {
    if (idbInstance) return Promise.resolve(idbInstance);
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = (e) => {
          idbInstance = e.target.result;
          resolve(idbInstance);
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  function idbSet(key, val) {
    getIDB().then(db => {
      if (!db) return;
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
      } catch (e) {}
    });
  }

  function idbDelete(key) {
    getIDB().then(db => {
      if (!db) return;
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
      } catch (e) {}
    });
  }

  function safeLocalStorageSet(key, valStr) {
    try {
      nativeLocalStorage.setItem(key, valStr);
    } catch (err) {
      // If QuotaExceededError or security storage limit hit, fall back safely to IndexedDB
      idbSet(key, valStr);
    }
  }

  // Unique client session instance ID (persisted across page reloads in the same tab via sessionStorage)
  let CLIENT_ID;
  try {
    CLIENT_ID = (typeof window !== 'undefined' && window.sessionStorage) ? window.sessionStorage.getItem('vf_presence_client_id') : null;
    if (!CLIENT_ID || typeof CLIENT_ID !== 'string' || !CLIENT_ID.startsWith('vf_client_')) {
      CLIENT_ID = 'vf_client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem('vf_presence_client_id', CLIENT_ID);
      }
    }
  } catch (e) {
    CLIENT_ID = 'vf_client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
  }

  // In-memory cache for instant synchronous reading across device sessions
  const cache = {};
  window.__vf_supabase_cache = cache;

  // Seed cache synchronously from native localStorage so page scripts have data instantly on page load (excluding local session keys)
  try {
    for (let i = 0; i < nativeLocalStorage.length; i++) {
      const k = nativeLocalStorage.key(i);
      if (k && !isLocalOnlyKey(k)) {
        cache[k] = nativeLocalStorage.getItem(k);
      }
    }
  } catch (e) {}

  // Hydrate additional large keys from IndexedDB asynchronously into in-memory cache
  getIDB().then(db => {
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (!cache[cursor.key] && !isLocalOnlyKey(cursor.key)) {
            cache[cursor.key] = cursor.value;
          }
          cursor.continue();
        }
      };
    } catch(e) {}
  });

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

  // --- Universal Intelligent Merge Engine (Eliminates Concurrent Multi-User Overwrites) ---
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
    // Composite log key for shift entries without explicit ID
    if (item.date && (item.shift || item.machine || item.machineNo || item.loom || item.loomNo || item.worker)) {
      return `log_${item.date}_${item.shift || ''}_${item.machine || item.machineNo || item.loom || item.loomNo || ''}_${item.productName || item.worker || ''}`;
    }
    return null;
  }

  function getDeletedTombstones() {
    let deleted = [];
    try {
      const raw = cache['vf_deleted_entity_ids'] || cache['vf_deleted_costing_ids'] || nativeLocalStorage.getItem('vf_deleted_entity_ids') || nativeLocalStorage.getItem('vf_deleted_costing_ids');
      if (raw) deleted = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch(e) {}
    return Array.isArray(deleted) ? deleted.map(String) : [];
  }

  function mergeDatasets(key, localVal, remoteVal) {
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

    // Case 1: Both are Arrays -> If remote state has been updated, remote state is authoritative unless local has recent edits
    if (Array.isArray(parsedLocal) && Array.isArray(parsedRemote)) {
      const lastWrite = lastLocalWrites[key] || 0;
      if (Date.now() - lastWrite < 3000) {
        return localVal;
      }
      return remoteVal;
    }

    // Case 2: Both are Plain Objects (Dictionaries / Settings / State Objects)
    if (parsedLocal && typeof parsedLocal === 'object' && !Array.isArray(parsedLocal) &&
        parsedRemote && typeof parsedRemote === 'object' && !Array.isArray(parsedRemote)) {
      const lastWrite = lastLocalWrites[key] || 0;
      if (Date.now() - lastWrite < 3000) {
        return localVal;
      }
      return remoteVal;
    }

    // Case 3: Primitive values -> Prefer remote server value unless locally edited within 3s
    const lastWrite = lastLocalWrites[key] || 0;
    if (Date.now() - lastWrite < 3000) {
      return localVal;
    }
    return remoteVal;
  }

  function applyRemoteKeyUpdate(key, valStr) {
    if (isLocalOnlyKey(key)) return;
    const currentVal = cache[key] || nativeLocalStorage.getItem(key);
    const finalVal = mergeDatasets(key, currentVal, valStr);
    const finalValSerialized = typeof finalVal === 'string' ? finalVal : JSON.stringify(finalVal);

    if (cache[key] !== finalValSerialized) {
      cache[key] = finalValSerialized;
      safeLocalStorageSet(key, finalValSerialized);
      lastSavedHashes[key] = computeHash(finalValSerialized);
      lastKnownTimestamps[key] = new Date().toISOString();

      window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key, value: finalValSerialized, isRemote: true } }));
      try {
        window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: finalValSerialized }));
      } catch(e) {
        window.dispatchEvent(new Event('storage'));
      }

      // If merge preserved local records that were not in incoming remote payload, sync union back
      if (finalValSerialized !== valStr && activeConfig.isConfigured) {
        let parsed = finalValSerialized;
        try { parsed = JSON.parse(finalValSerialized); } catch(e) {}
        supabaseApi.set(key, parsed);
      }
    }
  }

  function handleIncomingRemoteUpdate(key, valStr, isDelete = false) {
    if (isLocalOnlyKey(key)) return;
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

  // --- Realtime WebSocket & Presence Synchronization Engine (Google Sheets Style) ---
  // Zero Database Egress: Uses Phoenix Broadcast channel in Supabase server RAM
  let ws = null;
  let wsHeartbeatTimer = null;
  let wsReconnectTimer = null;
  let wsReconnectAttempts = 0;
  const WS_CHANNEL_TOPIC = 'realtime:vf_costing_sync';

  // --- Realtime Presence & Avatar Palette Engine ---
  const AVATAR_COLORS = [
    { bg: '#8b5cf6', fg: '#ffffff', glow: 'rgba(139, 92, 246, 0.45)', border: '#7c3aed', name: 'Purple' },
    { bg: '#3b82f6', fg: '#ffffff', glow: 'rgba(59, 130, 246, 0.45)', border: '#2563eb', name: 'Blue' },
    { bg: '#10b981', fg: '#ffffff', glow: 'rgba(16, 185, 129, 0.45)', border: '#059669', name: 'Emerald' },
    { bg: '#f59e0b', fg: '#ffffff', glow: 'rgba(245, 158, 11, 0.45)', border: '#d97706', name: 'Amber' },
    { bg: '#ec4899', fg: '#ffffff', glow: 'rgba(236, 72, 153, 0.45)', border: '#db2777', name: 'Pink' },
    { bg: '#06b6d4', fg: '#ffffff', glow: 'rgba(6, 182, 212, 0.45)', border: '#0891b2', name: 'Cyan' },
    { bg: '#f43f5e', fg: '#ffffff', glow: 'rgba(244, 63, 94, 0.45)', border: '#e11d48', name: 'Rose' },
    { bg: '#14b8a6', fg: '#ffffff', glow: 'rgba(20, 184, 166, 0.45)', border: '#0d9488', name: 'Teal' },
    { bg: '#84cc16', fg: '#ffffff', glow: 'rgba(132, 204, 22, 0.45)', border: '#65a30d', name: 'Lime' },
    { bg: '#6366f1', fg: '#ffffff', glow: 'rgba(99, 102, 241, 0.45)', border: '#4f46e5', name: 'Indigo' }
  ];

  function getLocalUserInfo() {
    let name = 'Operator';
    let role = 'Operator';
    let userId = CLIENT_ID;
    let email = '';
    
    try {
      const sessRaw = nativeLocalStorage.getItem('vf_session');
      if (sessRaw) {
        const sess = JSON.parse(sessRaw);
        if (sess.name) name = sess.name;
        else if (sess.username) name = sess.username;
        else if (sess.email) name = sess.email.split('@')[0];
        if (sess.role) role = sess.role.charAt(0).toUpperCase() + sess.role.slice(1);
        if (sess.id) userId = sess.id;
        if (sess.email) email = sess.email;
      } else {
        const savedUser = nativeLocalStorage.getItem('vf_user_name');
        if (savedUser) {
          name = savedUser;
          role = 'Operator';
        }
      }
    } catch(e) {}
    
    // Deterministic color assignment based on userId or email or name
    let hash = 0;
    const strForHash = (email || userId || name || CLIENT_ID).toLowerCase();
    for (let i = 0; i < strForHash.length; i++) {
      hash = (hash << 5) - hash + strForHash.charCodeAt(i);
      hash |= 0;
    }
    const colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
    const userColor = AVATAR_COLORS[colorIndex];
    
    // Compute user initials cleanly (e.g., vishwa@vishwafashions -> VI, rajiv@vishwafashions.com -> RA)
    let cleanName = name;
    if (cleanName.includes('@')) {
      cleanName = cleanName.split('@')[0];
    }
    cleanName = cleanName.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
    const parts = cleanName ? cleanName.split(/\s+/).filter(Boolean) : ['U'];
    let initials = 'U';
    if (parts.length >= 2 && parts[0] && parts[1]) {
      initials = (parts[0][0] + parts[1][0]).toUpperCase();
    } else if (parts[0] && parts[0].length >= 2) {
      initials = parts[0].slice(0, 2).toUpperCase();
    } else if (parts[0]) {
      initials = parts[0][0].toUpperCase();
    }

    return {
      id: userId,
      clientId: CLIENT_ID,
      name: name,
      email: email,
      initials: initials,
      role: role,
      color: userColor
    };
  }

  function getCurrentPageKey() {
    try {
      const path = window.location.pathname.toLowerCase();
      const page = path.split('/').pop() || 'index.html';
      return page.split('?')[0].split('#')[0];
    } catch(e) {
      return 'index.html';
    }
  }

  // Active in-memory presence store: clientId -> { user, page, tab, field, isTyping, lastPing, isSelf }
  const presenceStore = {};
  window.__vf_presence_store = presenceStore;

  function deduplicateUsers(users) {
    if (!Array.isArray(users)) return [];
    const userMap = new Map();
    users.forEach(u => {
      if (!u) return;
      // Key by user id or email or name (or fallback to clientId)
      const userKey = (u.user && (u.user.id || u.user.email || u.user.name)) || u.clientId;
      if (!userKey) return;
      const existing = userMap.get(userKey);
      if (!existing) {
        userMap.set(userKey, u);
      } else {
        // Prioritize active over away, typing over non-typing, and newer ping
        const preferCurrent = (!u.isAway && existing.isAway) ||
                              (u.isTyping && !existing.isTyping) ||
                              ((u.lastPing || 0) > (existing.lastPing || 0));
        if (preferCurrent) {
          userMap.set(userKey, {
            ...existing,
            ...u,
            isSelf: Boolean(existing.isSelf || u.isSelf)
          });
        }
      }
    });
    return Array.from(userMap.values());
  }

  function purgeStaleClientsForUser(userKey, currentClientId) {
    if (!userKey) return;
    Object.keys(presenceStore).forEach(cid => {
      if (cid !== currentClientId && cid !== CLIENT_ID) {
        const u = presenceStore[cid];
        const existingKey = (u.user && (u.user.id || u.user.email || u.user.name));
        if (existingKey === userKey) {
          delete presenceStore[cid];
        }
      }
    });
  }

  let presenceNotifyRaf = null;
  function notifyPresenceListeners() {
    if (presenceNotifyRaf) return;
    const schedule = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn => setTimeout(fn, 16));
    presenceNotifyRaf = schedule(() => {
      presenceNotifyRaf = null;
      const currentPage = getCurrentPageKey();
      const rawUsers = Object.values(presenceStore);
      const allUsers = deduplicateUsers(rawUsers);
      const pageUsers = deduplicateUsers(rawUsers.filter(u => !u.page || u.page === currentPage));
      try {
        window.dispatchEvent(new CustomEvent('supabase-presence', {
          detail: {
            users: allUsers,
            pageUsers: pageUsers,
            currentPage: currentPage,
            selfId: CLIENT_ID
          }
        }));
      } catch (e) {}
    });
  }

  function broadcastPresenceEvent(eventType, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: eventType,
            payload: payload
          },
          ref: 'pres_' + Date.now()
        }));
      } catch(e) {}
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: eventType,
          senderId: CLIENT_ID,
          payload: payload
        });
      } catch(e) {}
    }
  }

  function sendPresenceHello() {
    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const isAway = typeof document !== 'undefined' ? Boolean(document.hidden) : false;

    presenceStore[CLIENT_ID] = {
      clientId: CLIENT_ID,
      user: user,
      page: page,
      fullPath: window.location.pathname,
      href: window.location.href,
      tab: window.__vf_active_tab || '',
      field: window.__vf_active_field || '',
      qualityIndex: window.__vf_active_quality_index !== undefined ? window.__vf_active_quality_index : null,
      qualityName: window.__vf_active_quality_name || '',
      qualityId: window.__vf_active_quality_id || null,
      isTyping: false,
      isAway: isAway,
      lastPing: Date.now(),
      isSelf: true
    };

    const payload = {
      type: 'presence_hello',
      clientId: CLIENT_ID,
      user: user,
      page: page,
      fullPath: window.location.pathname,
      href: window.location.href,
      tab: window.__vf_active_tab || '',
      field: window.__vf_active_field || '',
      qualityIndex: window.__vf_active_quality_index !== undefined ? window.__vf_active_quality_index : null,
      qualityName: window.__vf_active_quality_name || '',
      qualityId: window.__vf_active_quality_id || null,
      isTyping: false,
      isAway: isAway,
      timestamp: Date.now()
    };

    broadcastPresenceEvent('presence_hello', payload);
    notifyPresenceListeners();
  }

  let announceJitterTimer = null;
  function sendPresenceAnnounce(immediate = false) {
    if (announceJitterTimer) return;
    const delay = immediate ? 0 : Math.floor(Math.random() * 35) + 10;
    announceJitterTimer = setTimeout(() => {
      announceJitterTimer = null;
      const self = presenceStore[CLIENT_ID];
      if (!self) return;
      self.lastPing = Date.now();
      const payload = {
        type: 'presence_announce',
        clientId: CLIENT_ID,
        user: self.user,
        page: self.page,
        fullPath: self.fullPath,
        href: self.href,
        tab: self.tab,
        field: self.field,
        qualityIndex: self.qualityIndex,
        qualityName: self.qualityName,
        qualityId: self.qualityId,
        isTyping: Boolean(self.isTyping),
        isAway: Boolean(self.isAway),
        timestamp: Date.now()
      };
      broadcastPresenceEvent('presence_announce', payload);
    }, delay);
  }

  function sendPresencePing(tab, field, isTyping = false, qualityIndex = undefined, qualityName = undefined, qualityId = undefined, isAway = undefined) {
    if (typeof qualityIndex === 'object' && qualityIndex !== null) {
      qualityName = qualityIndex.qualityName || qualityIndex.name;
      qualityId = qualityIndex.qualityId || qualityIndex.id;
      qualityIndex = qualityIndex.qualityIndex ?? qualityIndex.index;
    }

    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const currentTab = (tab !== undefined && tab !== null) ? tab : (window.__vf_active_tab || '');
    const currentField = (field !== undefined && field !== null) ? field : (window.__vf_active_field || '');
    const qIdx = qualityIndex !== undefined ? qualityIndex : (window.__vf_active_quality_index !== undefined ? window.__vf_active_quality_index : null);
    const qName = qualityName !== undefined ? qualityName : (window.__vf_active_quality_name || '');
    const qId = qualityId !== undefined ? qualityId : (window.__vf_active_quality_id || null);
    const awayStatus = isAway !== undefined ? Boolean(isAway) : (typeof document !== 'undefined' ? Boolean(document.hidden) : false);

    const payload = {
      type: 'presence_ping',
      clientId: CLIENT_ID,
      user: user,
      page: page,
      fullPath: window.location.pathname,
      href: window.location.href,
      tab: currentTab,
      field: currentField,
      qualityIndex: qIdx,
      qualityName: qName,
      qualityId: qId,
      isTyping: Boolean(isTyping),
      isAway: awayStatus,
      timestamp: Date.now()
    };

    presenceStore[CLIENT_ID] = {
      clientId: CLIENT_ID,
      user: user,
      page: page,
      fullPath: window.location.pathname,
      href: window.location.href,
      tab: currentTab,
      field: currentField,
      qualityIndex: qIdx,
      qualityName: qName,
      qualityId: qId,
      isTyping: Boolean(isTyping),
      isAway: awayStatus,
      lastPing: Date.now(),
      isSelf: true
    };

    broadcastPresenceEvent('presence_ping', payload);
    notifyPresenceListeners();
  }

  function sendPresenceLeave() {
    delete presenceStore[CLIENT_ID];
    const payload = {
      type: 'presence_leave',
      clientId: CLIENT_ID,
      page: getCurrentPageKey(),
      timestamp: Date.now()
    };

    broadcastPresenceEvent('presence_leave', payload);
    notifyPresenceListeners();
  }

  function handleIncomingPresenceHello(payload) {
    if (!payload || !payload.clientId || payload.clientId === CLIENT_ID) return;
    const userKey = (payload.user && (payload.user.id || payload.user.email || payload.user.name));
    purgeStaleClientsForUser(userKey, payload.clientId);
    presenceStore[payload.clientId] = {
      clientId: payload.clientId,
      user: payload.user || { name: 'User', role: 'Viewer', color: AVATAR_COLORS[0], initials: 'U' },
      page: payload.page || '',
      fullPath: payload.fullPath || '',
      href: payload.href || '',
      tab: payload.tab || '',
      field: payload.field || '',
      qualityIndex: payload.qualityIndex !== undefined ? payload.qualityIndex : null,
      qualityName: payload.qualityName || '',
      qualityId: payload.qualityId || null,
      isTyping: false,
      isAway: Boolean(payload.isAway),
      lastPing: Date.now(),
      isSelf: false
    };
    notifyPresenceListeners();
    // Mutual Discovery: Immediately announce self so the newcomer discovers us
    sendPresenceAnnounce();
  }

  function handleIncomingPresenceAnnounce(payload) {
    if (!payload || !payload.clientId || payload.clientId === CLIENT_ID) return;
    const userKey = (payload.user && (payload.user.id || payload.user.email || payload.user.name));
    purgeStaleClientsForUser(userKey, payload.clientId);
    presenceStore[payload.clientId] = {
      clientId: payload.clientId,
      user: payload.user || { name: 'User', role: 'Viewer', color: AVATAR_COLORS[0], initials: 'U' },
      page: payload.page || '',
      fullPath: payload.fullPath || '',
      href: payload.href || '',
      tab: payload.tab || '',
      field: payload.field || '',
      qualityIndex: payload.qualityIndex !== undefined ? payload.qualityIndex : null,
      qualityName: payload.qualityName || '',
      qualityId: payload.qualityId || null,
      isTyping: Boolean(payload.isTyping),
      isAway: Boolean(payload.isAway),
      lastPing: Date.now(),
      isSelf: false
    };
    notifyPresenceListeners();
  }

  function handleIncomingPresencePing(payload) {
    if (!payload || !payload.clientId || payload.clientId === CLIENT_ID) return;
    const userKey = (payload.user && (payload.user.id || payload.user.email || payload.user.name));
    purgeStaleClientsForUser(userKey, payload.clientId);
    const isNewPeer = !presenceStore[payload.clientId];
    presenceStore[payload.clientId] = {
      clientId: payload.clientId,
      user: payload.user || { name: 'User', role: 'Viewer', color: AVATAR_COLORS[0], initials: 'U' },
      page: payload.page || '',
      fullPath: payload.fullPath || '',
      href: payload.href || '',
      tab: payload.tab || '',
      field: payload.field || '',
      qualityIndex: payload.qualityIndex !== undefined ? payload.qualityIndex : null,
      qualityName: payload.qualityName || '',
      qualityId: payload.qualityId || null,
      isTyping: Boolean(payload.isTyping),
      isAway: Boolean(payload.isAway),
      lastPing: Date.now(),
      isSelf: false
    };
    notifyPresenceListeners();
    // If we receive a ping from someone not yet registered in our store, send back an announce
    if (isNewPeer) {
      sendPresenceAnnounce();
    }
  }

  function handleIncomingPresenceLeave(payload) {
    if (!payload || !payload.clientId) return;
    delete presenceStore[payload.clientId];
    notifyPresenceListeners();
  }

  function handleIncomingFieldFocus(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      window.dispatchEvent(new CustomEvent('supabase-field-focus', { detail: payload }));
    } catch(e) {}
  }

  function handleIncomingFieldChange(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      window.dispatchEvent(new CustomEvent('supabase-field-change', { detail: payload }));
    } catch(e) {}
  }

  // Purge disconnected users who haven't pinged in > 22 seconds (2 missed 10s heartbeats)
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    Object.keys(presenceStore).forEach(cid => {
      if (cid !== CLIENT_ID && now - (presenceStore[cid].lastPing || 0) > 22000) {
        delete presenceStore[cid];
        changed = true;
      }
    });
    if (changed) {
      notifyPresenceListeners();
    }
  }, 4000);

  // Send periodic presence ping every 10 seconds to keep presence fresh
  setInterval(() => {
    sendPresencePing();
  }, 10000);

  // Hook tab visibility & page unload
  // Note: Tab visibility change sets 'away' state instead of abruptly dropping user offline
  window.addEventListener('beforeunload', sendPresenceLeave);
  window.addEventListener('pagehide', sendPresenceLeave);
  document.addEventListener('visibilitychange', () => {
    const isAway = Boolean(document.hidden);
    if (presenceStore[CLIENT_ID]) {
      presenceStore[CLIENT_ID].isAway = isAway;
      presenceStore[CLIENT_ID].lastPing = Date.now();
    }
    sendPresencePing(null, null, false, undefined, undefined, undefined, isAway);
  });

  // Collaborative input & cell broadcasters with intelligent typing throttling
  let lastTypingBroadcastTime = 0;
  let typingResetTimer = null;
  let lastBroadcastFieldId = null;

  function handleLocalUserTyping(fieldId, tab) {
    if (presenceStore[CLIENT_ID]) {
      presenceStore[CLIENT_ID].isTyping = true;
      presenceStore[CLIENT_ID].lastPing = Date.now();
    }
    clearTimeout(typingResetTimer);
    typingResetTimer = setTimeout(() => {
      if (presenceStore[CLIENT_ID]) {
        presenceStore[CLIENT_ID].isTyping = false;
        presenceStore[CLIENT_ID].lastPing = Date.now();
      }
      sendPresencePing(tab, fieldId, false);
    }, 2500);

    const now = Date.now();
    if (now - lastTypingBroadcastTime > 1500) {
      lastTypingBroadcastTime = now;
      sendPresencePing(tab, fieldId, true);
    }
  }

  function broadcastFieldFocus(fieldId, isFocused, meta = {}) {
    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const payload = {
      type: 'field_focus',
      senderId: CLIENT_ID,
      user: user,
      page: page,
      tab: meta.tab || window.__vf_active_tab || '',
      fieldId: fieldId,
      isFocused: Boolean(isFocused),
      meta: meta,
      timestamp: Date.now()
    };

    if (isFocused) {
      window.__vf_active_field = fieldId;
    } else if (window.__vf_active_field === fieldId) {
      window.__vf_active_field = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: 'field_focus',
            payload: payload
          },
          ref: 'foc_' + Date.now()
        }));
      } catch(e) {}
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'field_focus',
          senderId: CLIENT_ID,
          payload: payload
        });
      } catch(e) {}
    }

    if (fieldId !== lastBroadcastFieldId) {
      lastBroadcastFieldId = fieldId;
      sendPresencePing(payload.tab, window.__vf_active_field, false);
    }
  }

  function broadcastFieldChange(fieldId, value, meta = {}) {
    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const payload = {
      type: 'field_change',
      senderId: CLIENT_ID,
      user: user,
      page: page,
      tab: meta.tab || window.__vf_active_tab || '',
      fieldId: fieldId,
      value: value,
      meta: meta,
      timestamp: Date.now()
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: 'field_change',
            payload: payload
          },
          ref: 'fchg_' + Date.now()
        }));
      } catch(e) {}
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'field_change',
          senderId: CLIENT_ID,
          payload: payload
        });
      } catch(e) {}
    }

    handleLocalUserTyping(fieldId, payload.tab);
  }

  // --- Realtime Collaborative Form & Input Field Synchronizer (Google Sheets Style) ---
  function initCollaborativeDOMSync() {
    const activeRemoteFocuses = new Map();
    let inputDebounceTimer = null;

    function getFieldIdentifier(el) {
      if (!el || !el.tagName) return null;
      const tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return null;
      if (el.type === 'password' || el.type === 'hidden') return null;
      
      if (el.dataset && el.dataset.collabId) return el.dataset.collabId;
      if (el.id && !el.id.startsWith('__')) return el.id;
      if (el.name) return el.name;

      const rowEl = el.closest('[data-row-id], [data-item-id], tr, li, .card, .product-card');
      const rowKey = rowEl ? (rowEl.dataset.rowId || rowEl.dataset.itemId || rowEl.id || Array.from(rowEl.parentElement ? rowEl.parentElement.children : []).indexOf(rowEl)) : 'form';
      const fieldKey = el.getAttribute('aria-label') || el.placeholder || el.type || 'inp';
      return `${rowKey}__${fieldKey}`.replace(/\s+/g, '_');
    }

    function findElementByFieldId(fieldId) {
      if (!fieldId) return null;
      try {
        let el = document.querySelector(`[data-collab-id="${CSS.escape(fieldId)}"]`) || document.getElementById(fieldId);
        if (el) return el;

        if (fieldId.includes('__')) {
          const [rowKey, fieldKey] = fieldId.split('__');
          const row = document.querySelector(`[data-row-id="${CSS.escape(rowKey)}"], [data-item-id="${CSS.escape(rowKey)}"], #${CSS.escape(rowKey)}`);
          if (row) {
            el = row.querySelector(`[name="${CSS.escape(fieldKey)}"], [placeholder="${CSS.escape(fieldKey)}"], [aria-label="${CSS.escape(fieldKey)}"]`);
            if (el) return el;
          }
        }
      } catch(e) {}
      return null;
    }

    function escapeHtmlStr(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Local user focus & typing broadcasters
    document.addEventListener('focusin', (e) => {
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      broadcastFieldFocus(fid, true, {
        label: e.target.placeholder || e.target.name || ''
      });
    }, true);

    document.addEventListener('focusout', (e) => {
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      broadcastFieldFocus(fid, false);
    }, true);

    document.addEventListener('input', (e) => {
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      const val = e.target.value;

      clearTimeout(inputDebounceTimer);
      inputDebounceTimer = setTimeout(() => {
        broadcastFieldChange(fid, val, {
          label: e.target.placeholder || e.target.name || ''
        });
      }, 20);
    }, true);

    document.addEventListener('change', (e) => {
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      const val = e.target.value;

      clearTimeout(inputDebounceTimer);
      broadcastFieldChange(fid, val, {
        label: e.target.placeholder || e.target.name || ''
      });
    }, true);

    // Incoming Remote Field Focus Handler
    window.addEventListener('supabase-field-focus', (e) => {
      const { fieldId, isFocused, user } = e.detail || {};
      if (!fieldId || !user) return;

      const el = findElementByFieldId(fieldId);
      
      // Clean up previous tag if any
      if (activeRemoteFocuses.has(fieldId)) {
        const prev = activeRemoteFocuses.get(fieldId);
        if (prev.tagEl) prev.tagEl.remove();
        if (prev.inputEl) {
          prev.inputEl.classList.remove('vf-collab-focus-ring');
          prev.inputEl.style.removeProperty('--vf-collab-color');
          prev.inputEl.style.removeProperty('--vf-collab-glow');
        }
        activeRemoteFocuses.delete(fieldId);
      }

      if (isFocused && el) {
        const color = user.color || { bg: '#8b5cf6', fg: '#ffffff', glow: 'rgba(139,92,246,0.35)' };
        el.classList.add('vf-collab-focus-ring');
        el.style.setProperty('--vf-collab-color', color.bg);
        el.style.setProperty('--vf-collab-glow', color.glow);

        const tag = document.createElement('div');
        tag.className = 'vf-collab-editor-tag';
        tag.style.setProperty('--vf-collab-color', color.bg);
        tag.innerHTML = `
          <span style="font-size:0.6rem;">●</span>
          <span>${escapeHtmlStr(user.name || 'User')} is editing</span>
        `;

        const parent = el.parentElement;
        if (parent) {
          const computedPos = window.getComputedStyle(parent).position;
          if (computedPos === 'static') {
            parent.style.position = 'relative';
          }
          parent.appendChild(tag);
        }

        activeRemoteFocuses.set(fieldId, { tagEl: tag, inputEl: el, user: user });
      }
    });

    // Incoming Remote Field Change Handler (Live Keystrokes)
    window.addEventListener('supabase-field-change', (e) => {
      const { fieldId, value } = e.detail || {};
      if (!fieldId) return;

      const el = findElementByFieldId(fieldId);
      if (!el) return;

      // Skip overwrite if local user is actively typing in this exact input
      if (document.activeElement === el) return;

      if (el.value !== value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ? 
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set : null;
        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ?
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set : null;
        
        if (el.tagName.toLowerCase() === 'input' && nativeInputValueSetter) {
          nativeInputValueSetter.call(el, value);
        } else if (el.tagName.toLowerCase() === 'textarea' && nativeTextAreaValueSetter) {
          nativeTextAreaValueSetter.call(el, value);
        } else {
          el.value = value;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCollaborativeDOMSync);
  } else {
    initCollaborativeDOMSync();
  }

  if (syncChannel) {
    syncChannel.onmessage = (msg) => {
      if (msg && msg.data) {
        const { key, value, type, senderId, payload } = msg.data;
        if (senderId === CLIENT_ID) return; // Skip own messages

        if (type === 'presence_hello' && payload) {
          handleIncomingPresenceHello(payload);
        } else if (type === 'presence_announce' && payload) {
          handleIncomingPresenceAnnounce(payload);
        } else if (type === 'presence_ping' && payload) {
          handleIncomingPresencePing(payload);
        } else if (type === 'presence_leave' && payload) {
          handleIncomingPresenceLeave(payload);
        } else if (type === 'field_focus' && payload) {
          handleIncomingFieldFocus(payload);
        } else if (type === 'field_change' && payload) {
          handleIncomingFieldChange(payload);
        } else if (key) {
          if (type === 'removeItem') {
            handleIncomingRemoteUpdate(key, null, true);
          } else {
            handleIncomingRemoteUpdate(key, value, false);
          }
        }
      }
    };
  }

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

        // Immediate presence announcement on socket connect with peer discovery
        sendPresenceHello();
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.event === 'broadcast' && data.payload) {
            const rawPayload = data.payload;
            const inner = (rawPayload && rawPayload.payload && typeof rawPayload.payload === 'object') ? rawPayload.payload : rawPayload;
            
            const sender = inner.senderId || inner.clientId || rawPayload.senderId || rawPayload.clientId;
            if (sender && sender === CLIENT_ID) return; // Skip own messages

            const eventType = inner.type || rawPayload.event || rawPayload.type || data.event;

            if (eventType === 'presence_hello') {
              handleIncomingPresenceHello(inner);
            } else if (eventType === 'presence_announce') {
              handleIncomingPresenceAnnounce(inner);
            } else if (eventType === 'presence_ping') {
              handleIncomingPresencePing(inner);
            } else if (eventType === 'presence_leave') {
              handleIncomingPresenceLeave(inner);
            } else if (eventType === 'field_focus') {
              handleIncomingFieldFocus(inner);
            } else if (eventType === 'field_change') {
              handleIncomingFieldChange(inner);
            } else if (inner.key || rawPayload.key) {
              const targetKey = inner.key || rawPayload.key;
              const targetVal = inner.value !== undefined ? inner.value : rawPayload.value;
              const valStr = typeof targetVal === 'string' ? targetVal : JSON.stringify(targetVal);
              handleIncomingRemoteUpdate(targetKey, valStr, false);
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
    if (isLocalOnlyKey(key)) return;
    const valStr = typeof value === 'string' ? value : JSON.stringify(value);
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
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          key: key,
          value: valStr,
          type: 'setItem',
          senderId: CLIENT_ID
        });
      } catch(e) {}
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
      if (isLocalOnlyKey(key)) return false;
      try {
        lastLocalWrites[key] = Date.now();

        const nowIso = new Date().toISOString();
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        const payloadHash = computeHash(valStr);

        // Always clear pending debounced write timer for this key immediately
        clearTimeout(debouncedWriteTimers[key]);

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
            cache[key] = valStr;

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
          debouncedWriteTimers[key] = setTimeout(executeDbWrite, 1200);
        }
        return true;
      } catch (e) {
        console.error('Supabase set error:', e);
        return false;
      }
    },
    async delete(key) {
      if (isLocalOnlyKey(key)) return;
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
    // Explicit Universal Item Deletion Tombstone Tracking
    async recordDeletion(key, itemId) {
      try {
        const idStr = String(itemId);
        let deletedIds = [];
        try {
          const raw = cache['vf_deleted_entity_ids'] || cache['vf_deleted_costing_ids'] || nativeLocalStorage.getItem('vf_deleted_entity_ids') || nativeLocalStorage.getItem('vf_deleted_costing_ids');
          if (raw) deletedIds = JSON.parse(raw);
        } catch (e) {}
        deletedIds = Array.isArray(deletedIds) ? deletedIds.map(String) : [];

        if (!deletedIds.includes(idStr)) {
          deletedIds.push(idStr);
          // Prune tombstone array to most recent 5000 items to avoid memory leaks
          if (deletedIds.length > 5000) {
            deletedIds = deletedIds.slice(-5000);
          }
          const valStr = JSON.stringify(deletedIds);
          cache['vf_deleted_entity_ids'] = valStr;
          cache['vf_deleted_costing_ids'] = valStr;
          safeLocalStorageSet('vf_deleted_entity_ids', valStr);
          safeLocalStorageSet('vf_deleted_costing_ids', valStr);
          this.set('vf_deleted_entity_ids', deletedIds, true);
        }

        // Delete from dedicated table if costing key
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
    async recordCostingDeletion(key, itemId) {
      return this.recordDeletion(key, itemId);
    },
    // Explicit Universal Item Undeletion / Restore Tracking (for Ctrl+Z Undo)
    async unrecordDeletion(key, itemId, itemData = null) {
      try {
        const idStr = String(itemId);
        let deletedIds = [];
        try {
          const raw = cache['vf_deleted_entity_ids'] || cache['vf_deleted_costing_ids'] || nativeLocalStorage.getItem('vf_deleted_entity_ids') || nativeLocalStorage.getItem('vf_deleted_costing_ids');
          if (raw) deletedIds = JSON.parse(raw);
        } catch (e) {}
        deletedIds = Array.isArray(deletedIds) ? deletedIds.map(String) : [];

        if (deletedIds.includes(idStr)) {
          deletedIds = deletedIds.filter(id => id !== idStr);
          const valStr = JSON.stringify(deletedIds);
          cache['vf_deleted_entity_ids'] = valStr;
          cache['vf_deleted_costing_ids'] = valStr;
          safeLocalStorageSet('vf_deleted_entity_ids', valStr);
          safeLocalStorageSet('vf_deleted_costing_ids', valStr);
          this.set('vf_deleted_entity_ids', deletedIds, true);
        }

        // Immediate re-insertion to dedicated Supabase table if itemData exists
        let table = null;
        if (key === 'costing-products-v4') table = 'vf_costing_products';
        else if (key === 'costing-tfo-products-v1') table = 'vf_costing_tfo_products';
        else if (key === 'costing-doubler-products-v1') table = 'vf_costing_doubler_products';
        else if (key === 'costing-covering-products-v1') table = 'vf_costing_covering_products';

        if (table && activeConfig.isConfigured && SUPABASE_URL && itemData) {
          fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify([{
              id: idStr,
              data: itemData,
              updated_at: new Date().toISOString()
            }])
          }).catch(() => {});
        }
      } catch (e) {}
    },
    async unrecordCostingDeletion(key, itemId, itemData = null) {
      return this.unrecordDeletion(key, itemId, itemData);
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
    getAuthHeaders(extraHeaders = {}) {
      let token = null;
      try { token = nativeLocalStorage.getItem('vf_supabase_token'); } catch(e) {}
      const bearer = token || SUPABASE_ANON_KEY;
      return Object.assign({
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      }, extraHeaders);
    },
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
        this.logAuditTrail('signup', 'auth', email, { role: metadata.role || 'employee' });
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

          this.logAuditTrail('login', 'auth', user.id || email, { email, role: sessionPayload.role });
        }
        
        return { data: data, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    },
    async refreshToken() {
      try {
        let session = null;
        try {
          const raw = nativeLocalStorage.getItem('vf_supabase_session');
          if (raw) session = JSON.parse(raw);
        } catch(e) {}
        if (!session || !session.refresh_token || !SUPABASE_URL) return null;
        
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.access_token) {
            nativeLocalStorage.setItem('vf_supabase_token', data.access_token);
            nativeLocalStorage.setItem('vf_supabase_session', JSON.stringify(data));
            return data.access_token;
          }
        }
      } catch(e) {}
      return null;
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
      
      this.logAuditTrail('logout', 'auth', null, {});

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
    // --- Enterprise Audit Logging API ---
    async logAuditTrail(action, entityType, entityId = null, details = {}) {
      if (!activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        const userInfo = getLocalUserInfo();
        const payload = {
          user_id: userInfo.userId || null,
          user_email: userInfo.email || userInfo.name || 'operator',
          role: userInfo.role || 'employee',
          action: action,
          entity_type: entityType,
          entity_id: entityId ? String(entityId) : null,
          details: details || {},
          created_at: new Date().toISOString()
        };
        fetch(`${SUPABASE_URL}/rest/v1/vf_audit_logs`, {
          method: 'POST',
          headers: this.getAuthHeaders({ 'Prefer': 'return=minimal' }),
          body: JSON.stringify(payload)
        }).catch(() => {});
      } catch(e) {}
    },
    async getAuditLogs(options = {}) {
      if (!activeConfig.isConfigured || !SUPABASE_URL) return { data: [], error: 'Not configured' };
      const limit = options.limit || 50;
      let url = `${SUPABASE_URL}/rest/v1/vf_audit_logs?select=*&order=created_at.desc&limit=${limit}`;
      if (options.entityType) url += `&entity_type=eq.${encodeURIComponent(options.entityType)}`;
      if (options.userEmail) url += `&user_email=eq.${encodeURIComponent(options.userEmail)}`;
      try {
        const res = await fetch(url, { headers: this.getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          return { data: data || [], error: null };
        }
        return { data: [], error: `HTTP ${res.status}` };
      } catch(e) {
        return { data: [], error: e.message || String(e) };
      }
    },
    // --- Server-Side RPC Health Check API ---
    async ping() {
      if (!activeConfig.isConfigured || !SUPABASE_URL) {
        return { ok: false, error: 'Database not configured' };
      }
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_ping`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({})
        });
        const elapsed = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const latency = Math.round(elapsed - t0);
        if (res.ok) {
          const data = await res.json();
          return { ok: true, latencyMs: latency, serverData: data };
        } else {
          // Fallback ping query if RPC not yet deployed
          const fallbackRes = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?select=key&limit=1`, {
            headers: this.getAuthHeaders()
          });
          const fallbackLatency = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
          return { ok: fallbackRes.ok, latencyMs: fallbackLatency, fallback: true };
        }
      } catch(e) {
        return { ok: false, error: e.message || String(e) };
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
              if (!row || !row.key || isLocalOnlyKey(row.key)) return;
              try {
                if (row.updated_at) lastKnownTimestamps[row.key] = row.updated_at;
                const strValue = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
                kvMap[row.key] = row.value;

                const localVal = cache[row.key] || nativeLocalStorage.getItem(row.key);
                const finalMerged = mergeDatasets(row.key, localVal, strValue);
                const finalStr = typeof finalMerged === 'string' ? finalMerged : JSON.stringify(finalMerged);

                lastSavedHashes[row.key] = computeHash(finalStr);

                const lastWrite = lastLocalWrites[row.key] || 0;
                if (Date.now() - lastWrite < 3000) {
                  pendingRemoteUpdates[row.key] = finalStr;
                  return;
                }

                if (cache[row.key] !== finalStr || isInitial) {
                  cache[row.key] = finalStr;
                  safeLocalStorageSet(row.key, finalStr);
                  updatedKeys.push(row.key);
                  hasChanges = true;

                  if (finalStr !== strValue && activeConfig.isConfigured) {
                    let parsed = finalStr;
                    try { parsed = JSON.parse(finalStr); } catch(e) {}
                    supabaseApi.set(row.key, parsed);
                  }
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
              deletedCostingIds = Array.isArray(deletedCostingIds) ? deletedCostingIds.map(String) : [];

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
                  // Retain locally cached items if they are not tombstoned
                  try {
                    const localRaw = cache[key] || nativeLocalStorage.getItem(key);
                    if (localRaw) {
                      const localArr = JSON.parse(localRaw);
                      if (Array.isArray(localArr)) {
                        localArr.forEach(item => {
                          if (item && item.id) {
                            const idStr = String(item.id);
                            if (!deletedCostingIds.includes(idStr) && !mergedMap.has(idStr)) {
                              mergedMap.set(idStr, item);
                            }
                          }
                        });
                      }
                    }
                  } catch(e) {}

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

        // Identify keys that have actually changed on the server (excluding local session keys)
        const changedKeys = [];
        metaRows.forEach(row => {
          if (!row || !row.key || isLocalOnlyKey(row.key)) return;
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
              if (!row || !row.key || isLocalOnlyKey(row.key)) return;
              try {
                if (row.updated_at) lastKnownTimestamps[row.key] = row.updated_at;
                const strValue = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
                const localVal = cache[row.key] || nativeLocalStorage.getItem(row.key);
                const finalMerged = mergeDatasets(row.key, localVal, strValue);
                const finalStr = typeof finalMerged === 'string' ? finalMerged : JSON.stringify(finalMerged);

                lastSavedHashes[row.key] = computeHash(finalStr);

                const lastWrite = lastLocalWrites[row.key] || 0;
                if (Date.now() - lastWrite < 3000) {
                  pendingRemoteUpdates[row.key] = finalStr;
                  return;
                }

                if (cache[row.key] !== finalStr) {
                  cache[row.key] = finalStr;
                  safeLocalStorageSet(row.key, finalStr);
                  updatedKeys.push(row.key);
                  hasChanges = true;

                  if (finalStr !== strValue && activeConfig.isConfigured) {
                    let parsed = finalStr;
                    try { parsed = JSON.parse(finalStr); } catch(e) {}
                    supabaseApi.set(row.key, parsed);
                  }
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
        window.dispatchEvent(new CustomEvent('supabase-ready', { detail: { isReady: true, keys: updatedKeys } }));
      }
    },
    // --- Realtime User Presence & Live Collaborative Editing APIs ---
    getCurrentUser: () => getLocalUserInfo(),
    getCurrentPage: () => getCurrentPageKey(),
    getPresenceStore: () => ({ ...presenceStore }),
    getPresence(page) {
      const targetPage = page || getCurrentPageKey();
      return deduplicateUsers(Object.values(presenceStore).filter(u => !u.page || u.page === targetPage));
    },
    getAllPresence: () => deduplicateUsers(Object.values(presenceStore)),
    sendPresenceHello: () => sendPresenceHello(),
    sendPresencePing: (tab, field, isTyping) => sendPresencePing(tab, field, isTyping),
    sendPresenceLeave: () => sendPresenceLeave(),
    broadcastFieldFocus: (fieldId, isFocused, meta) => broadcastFieldFocus(fieldId, isFocused, meta),
    broadcastFieldChange: (fieldId, value, meta) => broadcastFieldChange(fieldId, value, meta),
    getAvatarColors: () => AVATAR_COLORS
  };

  // Initial local presence announcement across same-browser tabs
  sendPresenceHello();

  // Initial boot: start Realtime WS and initial load
  if (activeConfig.isConfigured) {
    // Purge any accidental local-only keys previously stored in remote vf_kv_store
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=in.("vf_session","vf_user_name","vf_supabase_token","vf_supabase_session","vf_sidebar_open_folders","vf_sidebar_collapsed","vishwa_fashions_sidebar_mode","vishwa_fashions_theme")`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }).catch(() => {});
    }
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
      if (isLocalOnlyKey(key)) {
        try {
          return nativeLocalStorage.getItem(key);
        } catch(e) {
          return null;
        }
      }
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
      if (isLocalOnlyKey(key)) {
        safeLocalStorageSet(key, valStr);
        return;
      }
      cache[key] = valStr;
      lastLocalWrites[key] = Date.now();
      safeLocalStorageSet(key, valStr);

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
      if (isLocalOnlyKey(key)) {
        try {
          nativeLocalStorage.removeItem(key);
        } catch(e) {}
        idbDelete(key);
        return;
      }
      delete cache[key];
      lastLocalWrites[key] = Date.now();
      try {
        nativeLocalStorage.removeItem(key);
      } catch(e) {}
      idbDelete(key);
      if (syncChannel) {
        try { syncChannel.postMessage({ key: key, value: null, type: 'removeItem', senderId: CLIENT_ID }); } catch(e) {}
      }
      supabaseApi.delete(key);
    },
    clear: function() {
      Object.keys(cache).forEach(k => {
        if (!isLocalOnlyKey(k)) delete cache[k];
      });
      try {
        const savedSession = nativeLocalStorage.getItem('vf_session');
        const savedUserName = nativeLocalStorage.getItem('vf_user_name');
        const savedToken = nativeLocalStorage.getItem('vf_supabase_token');
        const savedSbSession = nativeLocalStorage.getItem('vf_supabase_session');
        nativeLocalStorage.clear();
        if (savedSession) nativeLocalStorage.setItem('vf_session', savedSession);
        if (savedUserName) nativeLocalStorage.setItem('vf_user_name', savedUserName);
        if (savedToken) nativeLocalStorage.setItem('vf_supabase_token', savedToken);
        if (savedSbSession) nativeLocalStorage.setItem('vf_supabase_session', savedSbSession);
      } catch(e) {}
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

