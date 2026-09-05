(function() {
  // Native browser localStorage reference before overriding
  const nativeLocalStorage = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);

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

  // Unique client session instance ID (Unique per window/tab lifecycle to prevent multi-tab collision)
  const CLIENT_ID = 'vf_client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);

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
    if (!item) return null;
    if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
    if (typeof item !== 'object') return null;
    if (item.id !== undefined && item.id !== null && String(item.id).trim() !== '') {
      return String(item.id).trim();
    }
    if (item._id !== undefined && item._id !== null && String(item._id).trim() !== '') {
      return String(item._id).trim();
    }
    if (item.uuid !== undefined && item.uuid !== null && String(item.uuid).trim() !== '') {
      return String(item.uuid).trim();
    }
    if (item.challanNo !== undefined && item.challanNo !== null && String(item.challanNo).trim() !== '') {
      return 'challan_' + String(item.challanNo).trim().toLowerCase();
    }
    if (item.boriNo !== undefined && item.boriNo !== null && String(item.boriNo).trim() !== '') {
      return 'bori_' + String(item.boriNo).trim().toLowerCase();
    }
    if (item.loanId !== undefined && item.loanId !== null && String(item.loanId).trim() !== '') {
      return String(item.loanId).trim();
    }
    if (item.empId !== undefined && item.empId !== null && String(item.empId).trim() !== '') {
      return String(item.empId).trim();
    }
    if (item.orderId || item.orderNo) {
      return 'ord_' + String(item.orderId || item.orderNo).trim();
    }
    if (item.billNo || item.invoiceNo) {
      return 'inv_' + String(item.billNo || item.invoiceNo).trim();
    }
    if (item.lotNo || item.lot) {
      return 'lot_' + String(item.lotNo || item.lot).trim() + '_' + (item.date || '') + '_' + (item.productName || item.color || '');
    }
    // Composite log key for shift entries without explicit ID
    if (item.date && (item.shift || item.machine || item.machineNo || item.loom || item.loomNo || item.worker)) {
      return `log_${item.date}_${item.shift || ''}_${item.machine || item.machineNo || item.loom || item.loomNo || ''}_${item.productName || item.worker || ''}`;
    }
    if (item.name !== undefined && item.name !== null && String(item.name).trim() !== '') {
      return String(item.name).trim();
    }
    if (item.syncKey !== undefined && item.syncKey !== null && String(item.syncKey).trim() !== '') {
      return String(item.syncKey).trim();
    }
    if (item.code !== undefined && item.code !== null && String(item.code).trim() !== '') {
      return String(item.code).trim();
    }
    return null;
  }

  function getDeletedTombstones() {
    let deleted = [];
    const tombstoneKeys = ['vf_deleted_entity_ids', 'vf_deleted_costing_ids', 'yarn_ledger_deleted_keys', 'vf_deleted_yarn_orders'];
    tombstoneKeys.forEach(tKey => {
      try {
        const raw = cache[tKey] || nativeLocalStorage.getItem(tKey);
        if (raw) {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            deleted = [...deleted, ...parsed];
          }
        }
      } catch(e) {}
    });
    return Array.from(new Set(deleted.map(s => String(s).trim()).filter(s => {
      if (!s) return false;
      // Filter out pure short sequence digits (e.g. "1", "2", "01") from global tombstones as they are document sequence numbers, not permanent entity IDs
      if (/^\d{1,4}$/.test(s)) return false;
      return true;
    })));
  }

  function filterDeletedEntities(a, b) {
    let arr = Array.isArray(a) ? a : (Array.isArray(b) ? b : null);
    if (!arr) return Array.isArray(a) ? a : (Array.isArray(b) ? b : a);
    const tombstones = getDeletedTombstones();
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
        if (item.syncKey && tombstoneSet.has(String(item.syncKey).trim().toLowerCase())) return false;
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
      } catch(e) {}
      return true;
    });
  }

  // --- Dedicated High-Integrity Merge Engine for Yarn Ledgers (Sales & Purchase) ---
  function mergeYarnLedgerDatasets(localArr, remoteArr) {
    if (!Array.isArray(localArr)) return Array.isArray(remoteArr) ? filterDeletedEntities(remoteArr) : [];
    if (!Array.isArray(remoteArr)) return Array.isArray(localArr) ? filterDeletedEntities(localArr) : [];

    const cleanLocal = filterDeletedEntities(localArr);
    const cleanRemote = filterDeletedEntities(remoteArr);

    const getRowKey = (row) => {
      if (!row) return '';
      if (row.syncKey) return String(row.syncKey).trim();
      if (row.id) return String(row.id).trim();
      if (row.challanNo && row.partyName) return `ledger_${String(row.challanNo).trim()}__${String(row.partyName).trim()}`;
      return '';
    };

    const rowMap = new Map();
    const keyToPrimaryMap = new Map();

    cleanRemote.forEach(remRow => {
      if (!remRow) return;
      const pKey = String(remRow.id || remRow.syncKey || getRowKey(remRow));
      if (!pKey) return;
      rowMap.set(pKey, { ...remRow });
      if (remRow.id) keyToPrimaryMap.set(String(remRow.id), pKey);
      if (remRow.syncKey) keyToPrimaryMap.set(String(remRow.syncKey), pKey);
      if (remRow.challanNo && remRow.partyName) {
        keyToPrimaryMap.set(`ledger_${String(remRow.challanNo).trim()}__${String(remRow.partyName).trim()}`, pKey);
      }
    });

    cleanLocal.forEach(locRow => {
      if (!locRow) return;
      const locPKey = String(locRow.id || locRow.syncKey || getRowKey(locRow));
      if (!locPKey) return;

      let matchedPKey = null;
      if (keyToPrimaryMap.has(locPKey)) matchedPKey = keyToPrimaryMap.get(locPKey);
      else if (locRow.id && keyToPrimaryMap.has(String(locRow.id))) matchedPKey = keyToPrimaryMap.get(String(locRow.id));
      else if (locRow.syncKey && keyToPrimaryMap.has(String(locRow.syncKey))) matchedPKey = keyToPrimaryMap.get(String(locRow.syncKey));
      else if (locRow.challanNo && locRow.partyName && keyToPrimaryMap.has(`ledger_${String(locRow.challanNo).trim()}__${String(locRow.partyName).trim()}`)) {
        matchedPKey = keyToPrimaryMap.get(`ledger_${String(locRow.challanNo).trim()}__${String(locRow.partyName).trim()}`);
      }

      if (matchedPKey && rowMap.has(matchedPKey)) {
        const remRow = rowMap.get(matchedPKey);
        const locTime = locRow.updated_at ? new Date(locRow.updated_at).getTime() : 0;
        const remTime = remRow.updated_at ? new Date(remRow.updated_at).getTime() : 0;

        if (locTime > remTime) {
          rowMap.set(matchedPKey, {
            ...remRow,
            ...locRow,
            id: locRow.syncKey ? (String(locRow.id).startsWith('PUR-') ? `PUR-${locRow.syncKey}` : `SAL-${locRow.syncKey}`) : locRow.id
          });
        } else {
          rowMap.set(matchedPKey, {
            ...locRow,
            ...remRow,
            id: remRow.syncKey ? (String(remRow.id).startsWith('PUR-') ? `PUR-${remRow.syncKey}` : `SAL-${remRow.syncKey}`) : (remRow.id || locRow.id)
          });
        }
      } else {
        rowMap.set(locPKey, { ...locRow });
        if (locRow.id) keyToPrimaryMap.set(String(locRow.id), locPKey);
        if (locRow.syncKey) keyToPrimaryMap.set(String(locRow.syncKey), locPKey);
      }
    });

    return filterDeletedEntities(Array.from(rowMap.values()));
  }

  // --- Dedicated High-Integrity Merge Engine for Yarn Sales Logs (Covering, TFO, Doubler/MX) ---
  function mergeYarnSalesDatasets(localArr, remoteArr, division = null) {
    if (!Array.isArray(localArr)) return Array.isArray(remoteArr) ? filterDeletedEntities(remoteArr) : [];
    if (!Array.isArray(remoteArr)) return Array.isArray(localArr) ? filterDeletedEntities(localArr) : [];

    const cleanLocal = filterDeletedEntities(localArr);
    const cleanRemote = filterDeletedEntities(remoteArr);

    const getSaleKeys = (sale) => {
      if (!sale) return [];
      const keys = [];
      if (sale.id && String(sale.id).trim()) keys.push(String(sale.id).trim());
      if (sale.challanNo && String(sale.challanNo).trim()) {
        const cClean = String(sale.challanNo).trim().toLowerCase();
        if (division) keys.push(`sale_${division}_${cClean}`);
        keys.push(`challan_${cClean}`);
      }
      if (sale.invoiceNo && String(sale.invoiceNo).trim()) {
        const invClean = String(sale.invoiceNo).trim().toLowerCase();
        if (division) keys.push(`sale_inv_${division}_${invClean}`);
        keys.push(`inv_${invClean}`);
      }
      return keys;
    };

    const saleMap = new Map();
    const keyToPrimaryMap = new Map();

    cleanRemote.forEach(remSale => {
      if (!remSale) return;
      const pKey = String(remSale.id || (remSale.challanNo ? (division ? `sale_${division}_${remSale.challanNo}` : `challan_${remSale.challanNo}`) : `rem_${Math.random()}`));
      saleMap.set(pKey, { ...remSale });
      getSaleKeys(remSale).forEach(k => keyToPrimaryMap.set(k, pKey));
    });

    cleanLocal.forEach(locSale => {
      if (!locSale) return;
      const locKeys = getSaleKeys(locSale);
      let matchedPKey = null;

      for (const k of locKeys) {
        if (keyToPrimaryMap.has(k)) {
          matchedPKey = keyToPrimaryMap.get(k);
          break;
        }
      }

      if (matchedPKey && saleMap.has(matchedPKey)) {
        const remSale = saleMap.get(matchedPKey);
        const locTime = locSale.updated_at ? new Date(locSale.updated_at).getTime() : (locSale.timestamp || 0);
        const remTime = remSale.updated_at ? new Date(remSale.updated_at).getTime() : (remSale.timestamp || 0);

        if (locTime >= remTime) {
          saleMap.set(matchedPKey, {
            ...remSale,
            ...locSale,
            id: locSale.id || remSale.id || matchedPKey
          });
        }
      } else {
        const locPKey = String(locSale.id || (locSale.challanNo ? (division ? `sale_${division}_${locSale.challanNo}` : `challan_${locSale.challanNo}`) : `loc_${Math.random()}`));
        saleMap.set(locPKey, { ...locSale });
        locKeys.forEach(k => keyToPrimaryMap.set(k, locPKey));
      }
    });

    const mergedList = filterDeletedEntities(Array.from(saleMap.values()));

    mergedList.sort((a, b) => {
      const dateA = a.date || a.saleDate || a.invoiceDate || '';
      const dateB = b.date || b.saleDate || b.invoiceDate || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const chA = a.challanNo || a.invoiceNo || a.id || '';
      const chB = b.challanNo || b.invoiceNo || b.id || '';
      return String(chB).localeCompare(String(chA), undefined, { numeric: true });
    });

    return mergedList;
  }

  // --- Dedicated High-Integrity Merge Engine for Yarn Production Logs (Covering, TFO, Doubler/MX) ---
  function mergeYarnProductionDatasets(localArr, remoteArr, division = null) {
    if (!Array.isArray(localArr)) return Array.isArray(remoteArr) ? filterDeletedEntities(remoteArr) : [];
    if (!Array.isArray(remoteArr)) return Array.isArray(localArr) ? filterDeletedEntities(localArr) : [];

    const cleanLocal = filterDeletedEntities(localArr);
    const cleanRemote = filterDeletedEntities(remoteArr);

    const getProdKeys = (prod) => {
      if (!prod) return [];
      const keys = [];
      if (prod.id) keys.push(String(prod.id).trim());
      if (prod.boriNo) {
        const bClean = String(prod.boriNo).trim().toLowerCase();
        keys.push(`bori_${bClean}`);
        if (division) keys.push(`prod_${division}_${bClean}`);
      }
      return keys;
    };

    const prodMap = new Map();
    const keyToPrimaryMap = new Map();

    cleanRemote.forEach(remProd => {
      if (!remProd) return;
      const pKey = String(remProd.id || (remProd.boriNo ? `bori_${remProd.boriNo}` : `rem_${Math.random()}`));
      prodMap.set(pKey, { ...remProd });
      getProdKeys(remProd).forEach(k => keyToPrimaryMap.set(k, pKey));
    });

    cleanLocal.forEach(locProd => {
      if (!locProd) return;
      const locKeys = getProdKeys(locProd);
      let matchedPKey = null;

      for (const k of locKeys) {
        if (keyToPrimaryMap.has(k)) {
          matchedPKey = keyToPrimaryMap.get(k);
          break;
        }
      }

      if (matchedPKey && prodMap.has(matchedPKey)) {
        const remProd = prodMap.get(matchedPKey);
        const locTime = locProd.updated_at ? new Date(locProd.updated_at).getTime() : (locProd.timestamp || 0);
        const remTime = remProd.updated_at ? new Date(remProd.updated_at).getTime() : (remProd.timestamp || 0);

        if (locTime >= remTime) {
          prodMap.set(matchedPKey, {
            ...remProd,
            ...locProd,
            id: locProd.id || remProd.id || matchedPKey
          });
        }
      } else {
        const locPKey = String(locProd.id || (locProd.boriNo ? `bori_${locProd.boriNo}` : `loc_${Math.random()}`));
        prodMap.set(locPKey, { ...locProd });
        locKeys.forEach(k => keyToPrimaryMap.set(k, locPKey));
      }
    });

    const mergedList = filterDeletedEntities(Array.from(prodMap.values()));

    mergedList.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const boriA = a.boriNo || a.id || '';
      const boriB = b.boriNo || b.id || '';
      return String(boriB).localeCompare(String(boriA), undefined, { numeric: true });
    });

    return mergedList;
  }

  // --- Dedicated High-Integrity Merge Engine for Yarn RM Stock Book ---
  function mergeYarnStockDatasets(localArr, remoteArr) {
    if (!Array.isArray(localArr)) return Array.isArray(remoteArr) ? filterDeletedEntities(remoteArr) : [];
    if (!Array.isArray(remoteArr)) return Array.isArray(localArr) ? filterDeletedEntities(localArr) : [];

    const cleanLocal = filterDeletedEntities(localArr);
    const cleanRemote = filterDeletedEntities(remoteArr);

    const getLotKeys = (lot) => {
      if (!lot) return [];
      const keys = [];
      if (lot.id) keys.push(String(lot.id).trim());
      if (lot.batchId) keys.push(String(lot.batchId).trim());
      const lNum = String(lot.lotNumber || '').trim();
      const lChallan = String(lot.challanNo || lot.challanNumber || '').trim();
      if (lNum && lChallan) keys.push(`${lNum}__${lChallan}`);
      if (lNum) keys.push(`lot_${lNum}`);
      return keys;
    };

    const mergedLotMap = new Map();

    const mergeLotPair = (baseLot, incomingLot) => {
      if (!baseLot) return { ...incomingLot };
      if (!incomingLot) return { ...baseLot };

      const baseTime = baseLot.updated_at ? new Date(baseLot.updated_at).getTime() : 0;
      const incomingTime = incomingLot.updated_at ? new Date(incomingLot.updated_at).getTime() : 0;
      const primaryLot = (incomingTime >= baseTime) ? incomingLot : baseLot;
      const secondaryLot = (incomingTime >= baseTime) ? baseLot : incomingLot;

      const boxMap = new Map();
      const baseBoxes = Array.isArray(baseLot.boxes) ? baseLot.boxes : [];
      const incomingBoxes = Array.isArray(incomingLot.boxes) ? incomingLot.boxes : [];

      baseBoxes.forEach(b => {
        if (!b) return;
        const bId = String(b.id || b.boxNumber || '').trim();
        if (bId) boxMap.set(bId, { ...b });
      });

      incomingBoxes.forEach(incBox => {
        if (!incBox) return;
        const bId = String(incBox.id || incBox.boxNumber || '').trim();
        if (!bId) return;

        if (!boxMap.has(bId)) {
          boxMap.set(bId, { ...incBox });
        } else {
          const curBox = boxMap.get(bId);

          const curUpdated = curBox.updated_at ? new Date(curBox.updated_at).getTime() : 0;
          const incUpdated = incBox.updated_at ? new Date(incBox.updated_at).getTime() : 0;
          const winner = (incUpdated >= curUpdated) ? incBox : curBox;
          const loser = (incUpdated >= curUpdated) ? curBox : incBox;

          const prevIssueDate = incBox.previousIssueDate || curBox.previousIssueDate || (incBox.status === 'issued' ? incBox.issueDate : (curBox.status === 'issued' ? curBox.issueDate : null));
          const prevIssuedTo = incBox.previousIssuedTo || curBox.previousIssuedTo || (incBox.status === 'issued' ? incBox.issuedTo : (curBox.status === 'issued' ? curBox.issuedTo : null));

          const isWinnerGr = (winner.status === 'gr') || (winner.grWeight > 0 && winner.grWeight >= (winner.grossWeight || winner.weight || 1));

          if (isWinnerGr) {
            boxMap.set(bId, {
              ...loser,
              ...winner,
              status: 'gr',
              issueDate: null,
              issuedTo: null,
              previousIssueDate: prevIssueDate,
              previousIssuedTo: prevIssuedTo
            });
            return;
          }

          if (curBox.status === 'issued' && incBox.status === 'issued') {
            boxMap.set(bId, {
              ...curBox,
              ...incBox,
              status: 'issued',
              issueDate: winner.issueDate || curBox.issueDate || incBox.issueDate || prevIssueDate,
              issuedTo: winner.issuedTo || curBox.issuedTo || incBox.issuedTo || prevIssuedTo,
              previousIssueDate: prevIssueDate,
              previousIssuedTo: prevIssuedTo,
              updated_at: winner.updated_at || incBox.updated_at || curBox.updated_at
            });
          } else if (curBox.status !== 'issued' && incBox.status !== 'issued') {
            const wasIssued = Boolean(prevIssueDate && (!winner.unissued_at || new Date(winner.unissued_at).getTime() < new Date(prevIssueDate).getTime()));
            if (wasIssued) {
              boxMap.set(bId, {
                ...loser,
                ...winner,
                status: 'issued',
                issueDate: prevIssueDate,
                issuedTo: prevIssuedTo || 'Department',
                previousIssueDate: prevIssueDate,
                previousIssuedTo: prevIssuedTo,
                updated_at: winner.updated_at || new Date().toISOString()
              });
            } else {
              boxMap.set(bId, {
                ...curBox,
                ...incBox,
                status: 'available',
                issueDate: null,
                issuedTo: null,
                previousIssueDate: null,
                previousIssuedTo: null,
                unissued_at: winner.unissued_at || incBox.unissued_at || curBox.unissued_at || winner.updated_at,
                updated_at: winner.updated_at || incBox.updated_at || curBox.updated_at
              });
            }
          } else {
            // One is issued, the other is available (unissued)
            const issuedBox = (curBox.status === 'issued') ? curBox : incBox;
            const availBox = (curBox.status === 'issued') ? incBox : curBox;

            const issuedTime = Math.max(
              issuedBox.updated_at ? new Date(issuedBox.updated_at).getTime() : 0,
              issuedBox.issueDate ? new Date(issuedBox.issueDate).getTime() : 0
            );
            const unissuedTime = availBox.unissued_at ? new Date(availBox.unissued_at).getTime() : 0;

            // An available box ONLY overwrites an issued box if it was explicitly unissued after the issuance
            if (unissuedTime > 0 && unissuedTime >= issuedTime) {
              boxMap.set(bId, {
                ...issuedBox,
                ...availBox,
                status: 'available',
                issueDate: null,
                issuedTo: null,
                previousIssueDate: null,
                previousIssuedTo: null,
                unissued_at: availBox.unissued_at,
                updated_at: availBox.updated_at || new Date().toISOString()
              });
            } else {
              boxMap.set(bId, {
                ...availBox,
                ...issuedBox,
                status: 'issued',
                issueDate: issuedBox.issueDate || prevIssueDate,
                issuedTo: issuedBox.issuedTo || prevIssuedTo,
                previousIssueDate: prevIssueDate,
                previousIssuedTo: prevIssuedTo,
                updated_at: issuedBox.updated_at || new Date().toISOString()
              });
            }
          }
        }
      });

      return {
        ...secondaryLot,
        ...primaryLot,
        boxes: Array.from(boxMap.values())
      };
    };

    const lotIndexMap = new Map();
    cleanLocal.forEach(lot => {
      if (!lot) return;
      const primaryKey = String(lot.id || lot.batchId || `${lot.lotNumber}__${lot.challanNo}`);
      mergedLotMap.set(primaryKey, { ...lot });
      getLotKeys(lot).forEach(k => lotIndexMap.set(k, primaryKey));
    });

    cleanRemote.forEach(remLot => {
      if (!remLot) return;
      let matchedPrimaryKey = null;
      for (const k of getLotKeys(remLot)) {
        if (lotIndexMap.has(k)) {
          matchedPrimaryKey = lotIndexMap.get(k);
          break;
        }
      }

      if (matchedPrimaryKey && mergedLotMap.has(matchedPrimaryKey)) {
        const existingLot = mergedLotMap.get(matchedPrimaryKey);
        const mergedLot = mergeLotPair(existingLot, remLot);
        mergedLotMap.set(matchedPrimaryKey, mergedLot);
      } else {
        const newPrimaryKey = String(remLot.id || remLot.batchId || `${remLot.lotNumber}__${remLot.challanNo}`);
        mergedLotMap.set(newPrimaryKey, { ...remLot });
        getLotKeys(remLot).forEach(k => lotIndexMap.set(k, newPrimaryKey));
      }
    });

    const allMergedLots = Array.from(mergedLotMap.values());

    // Single Source of Truth Enforcement: Reconcile stock lots strictly against active yarn-rm-orders
    const rawOrders = (typeof cache !== 'undefined' && cache && cache['yarn-rm-orders']) || (nativeLocalStorage && typeof nativeLocalStorage.getItem === 'function' ? nativeLocalStorage.getItem('yarn-rm-orders') : null);
    if (rawOrders !== null && rawOrders !== undefined) {
      try {
        const parsedOrders = typeof rawOrders === 'string' ? JSON.parse(rawOrders) : rawOrders;
        if (Array.isArray(parsedOrders)) {
          if (parsedOrders.length > 0) {
            const activeKeys = new Set();
            parsedOrders.forEach(ord => {
              if (!ord) return;
              if (ord.id) activeKeys.add(String(ord.id).trim());
              if (ord.orderNumber) activeKeys.add(String(ord.orderNumber).trim());
              (ord.batches || []).forEach(b => {
                if (!b) return;
                if (b.id) activeKeys.add(String(b.id).trim());
                const bLot = String(b.lotNumber || '').trim();
                const bChallan = String(b.challanNumber || '').trim();
                if (bLot && bChallan) activeKeys.add(`${bLot}__${bChallan}`);
                if (bLot) activeKeys.add(`lot_${bLot}`);
              });
            });

            if (activeKeys.size > 0) {
              const filteredLots = allMergedLots.filter(lot => {
                if (!lot) return false;
                const lId = String(lot.id || '').trim();
                const bId = String(lot.batchId || '').trim();
                const oRef = String(lot.orderRef || '').trim();
                const lNum = String(lot.lotNumber || '').trim();
                const lChallan = String(lot.challanNo || lot.challanNumber || '').trim();

                if (bId && activeKeys.has(bId)) return true;
                if (lId && activeKeys.has(lId)) return true;
                if (oRef && activeKeys.has(oRef)) return true;
                if (lNum && lChallan && activeKeys.has(`${lNum}__${lChallan}`)) return true;
                if (lNum && activeKeys.has(`lot_${lNum}`)) return true;

                return false;
              });

              return filteredLots;
            }
          } else if (cleanRemote.length === 0 && cleanLocal.length > 0 && Array.isArray(remoteArr) && remoteArr.length === 0) {
            // Both remote stock is explicitly empty AND orders are explicitly empty -> stock is empty
            return [];
          }
        }
      } catch(e) {}
    }

    return allMergedLots;
  }

  // --- Dedicated High-Integrity Merge Engine for Yarn RM Orders ---
  function mergeYarnOrdersDatasets(localArr, remoteArr) {
    if (!Array.isArray(localArr)) return Array.isArray(remoteArr) ? filterDeletedEntities(remoteArr) : [];
    if (!Array.isArray(remoteArr)) return Array.isArray(localArr) ? filterDeletedEntities(localArr) : [];

    const cleanLocal = filterDeletedEntities(localArr);
    const cleanRemote = filterDeletedEntities(remoteArr);
    const lastWrite = lastLocalWrites['yarn-rm-orders'] || 0;
    const isLocallyActive = (Date.now() - lastWrite < 1500);

    if (cleanRemote.length > 0 && cleanLocal.length === 0) {
      return cleanRemote;
    }

    const orderMap = new Map();
    const keyToOrderMap = new Map();

    const getOrderKeys = (ord) => {
      const keys = [];
      if (!ord) return keys;
      if (ord.id) keys.push(String(ord.id).trim());
      if (ord.orderNumber) keys.push(String(ord.orderNumber).trim());
      return keys;
    };

    cleanRemote.forEach(remOrd => {
      const keys = getOrderKeys(remOrd);
      const primaryKey = keys[0] || ('REM-' + Math.random());
      orderMap.set(primaryKey, { ...remOrd });
      keys.forEach(k => keyToOrderMap.set(k, primaryKey));
    });

    cleanLocal.forEach(locOrd => {
      const keys = getOrderKeys(locOrd);
      let matchedPrimaryKey = null;
      for (const k of keys) {
        if (keyToOrderMap.has(k)) {
          matchedPrimaryKey = keyToOrderMap.get(k);
          break;
        }
      }

      if (!matchedPrimaryKey) {
        if (isLocallyActive) {
          const primaryKey = keys[0] || ('LOC-' + Math.random());
          orderMap.set(primaryKey, { ...locOrd });
          keys.forEach(k => keyToOrderMap.set(k, primaryKey));
        }
      } else {
        const remOrd = orderMap.get(matchedPrimaryKey);
        const locTime = (locOrd.updated_at || locOrd.updatedAt || locOrd.createdAt) ? new Date(locOrd.updated_at || locOrd.updatedAt || locOrd.createdAt).getTime() : 0;
        const remTime = (remOrd.updated_at || remOrd.updatedAt || remOrd.createdAt) ? new Date(remOrd.updated_at || remOrd.updatedAt || remOrd.createdAt).getTime() : 0;
        
        // Remote is authoritative source of truth unless local edit is strictly active and newer
        const baseOrd = (locTime > remTime && isLocallyActive) ? locOrd : remOrd;

        const batchMap = new Map();
        const getBatchKey = (b) => b ? String(b.id || `${b.lotNumber}__${b.challanNumber}`).trim() : '';

        (remOrd.batches || []).forEach(b => {
          const bk = getBatchKey(b);
          if (bk) batchMap.set(bk, { ...b });
        });

        (locOrd.batches || []).forEach(locB => {
          const bk = getBatchKey(locB);
          if (!bk) return;
          if (!batchMap.has(bk)) {
            if (isLocallyActive) batchMap.set(bk, { ...locB });
          } else {
            const remB = batchMap.get(bk);
            const bBoxMap = new Map();
            (remB.boxes || []).forEach(bx => {
              const bxId = String(bx.boxNumber || bx.id || '').trim();
              if (bxId) bBoxMap.set(bxId, { ...bx });
            });

            (locB.boxes || []).forEach(locBx => {
              const bxId = String(locBx.boxNumber || locBx.id || '').trim();
              if (!bxId) return;
              if (!bBoxMap.has(bxId)) {
                if (isLocallyActive) bBoxMap.set(bxId, { ...locBx });
              } else {
                const remBx = bBoxMap.get(bxId);
                const locUpdated = locBx.updated_at ? new Date(locBx.updated_at).getTime() : 0;
                const remUpdated = remBx.updated_at ? new Date(remBx.updated_at).getTime() : 0;
                const winner = (locUpdated >= remUpdated) ? locBx : remBx;
                const loser = (locUpdated >= remUpdated) ? remBx : locBx;

                const prevIssueDate = locBx.previousIssueDate || remBx.previousIssueDate || (locBx.status === 'issued' ? locBx.issueDate : (remBx.status === 'issued' ? remBx.issueDate : null));
                const prevIssuedTo = locBx.previousIssuedTo || remBx.previousIssuedTo || (locBx.status === 'issued' ? locBx.issuedTo : (remBx.status === 'issued' ? remBx.issuedTo : null));

                const isWinnerGr = (winner.status === 'gr') || (Number(winner.returnedWeight) > 0 && Number(winner.returnedWeight) >= (Number(winner.weight) || 1));

                if (isWinnerGr) {
                  bBoxMap.set(bxId, {
                    ...loser,
                    ...winner,
                    status: 'gr',
                    issueDate: null,
                    issuedTo: null,
                    previousIssueDate: prevIssueDate,
                    previousIssuedTo: prevIssuedTo
                  });
                  return;
                }

                if (locBx.status === 'issued' && remBx.status === 'issued') {
                  bBoxMap.set(bxId, {
                    ...remBx,
                    ...locBx,
                    status: 'issued',
                    issueDate: winner.issueDate || locBx.issueDate || remBx.issueDate || prevIssueDate,
                    issuedTo: winner.issuedTo || locBx.issuedTo || remBx.issuedTo || prevIssuedTo,
                    previousIssueDate: prevIssueDate,
                    previousIssuedTo: prevIssuedTo,
                    updated_at: winner.updated_at || locBx.updated_at || remBx.updated_at
                  });
                } else if (locBx.status !== 'issued' && remBx.status !== 'issued') {
                  const wasIssued = Boolean(prevIssueDate && (!winner.unissued_at || new Date(winner.unissued_at).getTime() < new Date(prevIssueDate).getTime()));
                  if (wasIssued) {
                    bBoxMap.set(bxId, {
                      ...loser,
                      ...winner,
                      status: 'issued',
                      issueDate: prevIssueDate,
                      issuedTo: prevIssuedTo || 'Department',
                      previousIssueDate: prevIssueDate,
                      previousIssuedTo: prevIssuedTo,
                      updated_at: winner.updated_at || new Date().toISOString()
                    });
                  } else {
                    bBoxMap.set(bxId, {
                      ...remBx,
                      ...locBx,
                      status: 'available',
                      issueDate: null,
                      issuedTo: null,
                      previousIssueDate: null,
                      previousIssuedTo: null,
                      unissued_at: winner.unissued_at || locBx.unissued_at || remBx.unissued_at || winner.updated_at,
                      updated_at: winner.updated_at || locBx.updated_at || remBx.updated_at
                    });
                  }
                } else {
                  const issuedBx = (locBx.status === 'issued') ? locBx : remBx;
                  const availBx = (locBx.status === 'issued') ? remBx : locBx;

                  const issuedTime = Math.max(
                    issuedBx.updated_at ? new Date(issuedBx.updated_at).getTime() : 0,
                    issuedBx.issueDate ? new Date(issuedBx.issueDate).getTime() : 0
                  );
                  const unissuedTime = availBx.unissued_at ? new Date(availBx.unissued_at).getTime() : 0;

                  // An available box ONLY overwrites an issued box if it was explicitly unissued after the issuance
                  if (unissuedTime > 0 && unissuedTime >= issuedTime) {
                    bBoxMap.set(bxId, {
                      ...issuedBx,
                      ...availBx,
                      status: 'available',
                      issueDate: null,
                      issuedTo: null,
                      previousIssueDate: null,
                      previousIssuedTo: null,
                      unissued_at: availBx.unissued_at,
                      updated_at: availBx.updated_at || new Date().toISOString()
                    });
                  } else {
                    bBoxMap.set(bxId, {
                      ...availBx,
                      ...issuedBx,
                      status: 'issued',
                      issueDate: issuedBx.issueDate || prevIssueDate,
                      issuedTo: issuedBx.issuedTo || prevIssuedTo,
                      previousIssueDate: prevIssueDate,
                      previousIssuedTo: prevIssuedTo,
                      updated_at: issuedBx.updated_at || new Date().toISOString()
                    });
                  }
                }
              }
            });

            batchMap.set(bk, {
              ...remB,
              ...locB,
              boxes: Array.from(bBoxMap.values())
            });
          }
        });

        orderMap.set(matchedPrimaryKey, {
          ...remOrd,
          ...baseOrd,
          batches: Array.from(batchMap.values())
        });
      }
    });

    return filterDeletedEntities(Array.from(orderMap.values()));
  }

  function mergeDatasets(key, localVal, remoteVal) {
    if (localVal === undefined || localVal === null) {
      if (typeof remoteVal === 'string' && (remoteVal.startsWith('[') || remoteVal.startsWith('{'))) {
        try {
          const parsed = JSON.parse(remoteVal);
          if (Array.isArray(parsed)) return filterDeletedEntities(parsed);
          if (parsed && typeof parsed === 'object') {
            const cloned = { ...parsed };
            if (Array.isArray(cloned.employees)) cloned.employees = filterDeletedEntities(cloned.employees);
            if (Array.isArray(cloned.machines)) cloned.machines = filterDeletedEntities(cloned.machines);
            if (Array.isArray(cloned.loans)) cloned.loans = filterDeletedEntities(cloned.loans);
            return cloned;
          }
        } catch(e) {}
      }
      return remoteVal;
    }
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

    // Special Case: Yarn RM Stock Book Array Merge (Sync Box Statuses Across Devices)
    if (key === 'vishwa_yarn_rm_stock_data' && Array.isArray(parsedLocal) && Array.isArray(parsedRemote)) {
      return mergeYarnStockDatasets(parsedLocal, parsedRemote);
    }

    // Special Case: Yarn RM Orders Array Merge (Sync Box Statuses inside batches)
    if (key === 'yarn-rm-orders' && Array.isArray(parsedLocal) && Array.isArray(parsedRemote)) {
      return mergeYarnOrdersDatasets(parsedLocal, parsedRemote);
    }

    // Special Case: Yarn Ledgers (Sales & Purchase) Multi-PC Synchronization
    if ((key === 'yarn_sales_ledger_data' || key === 'yarn_purchase_ledger_data') && (Array.isArray(parsedLocal) || Array.isArray(parsedRemote))) {
      return mergeYarnLedgerDatasets(parsedLocal, parsedRemote);
    }

    // Special Case: Yarn Sales Logs (Covering, TFO, Doubler/MX) Multi-PC Synchronization
    if (typeof key === 'string' && key.startsWith('yarn_') && key.endsWith('_sales_logs') && (Array.isArray(parsedLocal) || Array.isArray(parsedRemote))) {
      const division = key.replace('yarn_', '').replace('_sales_logs', '');
      return mergeYarnSalesDatasets(parsedLocal, parsedRemote, division);
    }

    // Special Case: Yarn Production Logs (Covering, TFO, Doubler/MX) Multi-PC Synchronization
    if (typeof key === 'string' && key.startsWith('yarn_') && key.endsWith('_production_logs') && (Array.isArray(parsedLocal) || Array.isArray(parsedRemote))) {
      const division = key.replace('yarn_', '').replace('_production_logs', '');
      return mergeYarnProductionDatasets(parsedLocal, parsedRemote, division);
    }

    // Case 1: Both are Arrays -> Intelligent Item-Level Merge for multi-user safety
    if (Array.isArray(parsedLocal) && Array.isArray(parsedRemote)) {
      const cleanLocal = filterDeletedEntities(parsedLocal);
      const cleanRemote = filterDeletedEntities(parsedRemote);
      const lastWrite = lastLocalWrites[key] || 0;
      const isLocallyActive = (Date.now() - lastWrite < 3000);

      // Master entity registries (dropdowns/catalogs): when remote arrives and local user is not actively typing,
      // the remote server snapshot is the single source of truth. Deleted items must NOT be resurrected!
      const MASTER_ENTITY_KEYS = [
        'yarn-qualities', 'yarn-fp-qualities', 'yarn-suppliers', 'manage-looms', 'manage-jacquards',
        'manage-jalas', 'manage-fanis', 'machines', 'warp-beams', 'warp-issues',
        'yarn-issues', 'costing-products-v4', 'costing-tfo-products-v1',
        'costing-doubler-products-v1', 'costing-covering-products-v1'
      ];

      const isMasterKey = MASTER_ENTITY_KEYS.includes(key);

      // Absolute protection: If remote has master data and local is empty, always adopt remote
      if (isMasterKey && cleanRemote.length > 0 && cleanLocal.length === 0) {
        return cleanRemote;
      }

      if (isMasterKey && !isLocallyActive) {
        return cleanRemote;
      }

      // Build Map with remote items as baseline
      const itemMap = new Map();
      cleanRemote.forEach(item => {
        const id = getItemIdentifier(item);
        if (id) itemMap.set(String(id), item);
      });

      // Merge local items: keep local edits if newer or if locally active
      cleanLocal.forEach(localItem => {
        const id = getItemIdentifier(localItem);
        if (id) {
          if (itemMap.has(String(id))) {
            const remoteItem = itemMap.get(String(id));
            const remoteTime = remoteItem.updated_at ? new Date(remoteItem.updated_at).getTime() : (remoteItem.timestamp || 0);
            const localTime = localItem.updated_at ? new Date(localItem.updated_at).getTime() : (localItem.timestamp || 0);
            if (localTime >= remoteTime) {
              itemMap.set(String(id), localItem);
            }
          } else if (isLocallyActive) {
            // Only preserve un-synced additions if user is actively writing
            itemMap.set(String(id), localItem);
          }
        }
      });

      const mergedList = filterDeletedEntities(Array.from(itemMap.values()));
      // If neither had identifiable items, fallback to latest authority
      if (mergedList.length === 0 && (cleanLocal.length > 0 || cleanRemote.length > 0)) {
        return isLocallyActive ? cleanLocal : cleanRemote;
      }
      return mergedList;
    }

    if (Array.isArray(parsedRemote)) {
      return filterDeletedEntities(parsedRemote);
    }
    if (Array.isArray(parsedLocal)) {
      return filterDeletedEntities(parsedLocal);
    }

    // Case 2: Both are Plain Objects (Dictionaries / Settings / State Objects)
    if (parsedLocal && typeof parsedLocal === 'object' && !Array.isArray(parsedLocal) &&
        parsedRemote && typeof parsedRemote === 'object' && !Array.isArray(parsedRemote)) {
      const lastWrite = lastLocalWrites[key] || 0;
      const isLocallyActive = (Date.now() - lastWrite < 3000);

      // Special handling for Staff & Salary state objects (e.g. aethertasks_db_state_v7)
      if (Array.isArray(parsedLocal.employees) || Array.isArray(parsedRemote.employees) ||
          Array.isArray(parsedLocal.loans) || Array.isArray(parsedRemote.loans) ||
          (parsedLocal.attendance && typeof parsedLocal.attendance === 'object') || (parsedRemote.attendance && typeof parsedRemote.attendance === 'object')) {
        
        if (!isLocallyActive) {
          return {
            ...parsedRemote,
            employees: Array.isArray(parsedRemote.employees) ? filterDeletedEntities(parsedRemote.employees) : (parsedRemote.employees || []),
            machines: Array.isArray(parsedRemote.machines) ? filterDeletedEntities(parsedRemote.machines) : (parsedRemote.machines || []),
            loans: Array.isArray(parsedRemote.loans) ? filterDeletedEntities(parsedRemote.loans) : (parsedRemote.loans || []),
            attendance: (parsedRemote.attendance && typeof parsedRemote.attendance === 'object') ? parsedRemote.attendance : {},
            salaryPayments: (parsedRemote.salaryPayments && typeof parsedRemote.salaryPayments === 'object') ? parsedRemote.salaryPayments : {}
          };
        }

        // When actively editing on this PC within 3s, intelligently merge local changes
        const localEmps = Array.isArray(parsedLocal.employees) ? filterDeletedEntities(parsedLocal.employees) : [];
        const remoteEmps = Array.isArray(parsedRemote.employees) ? filterDeletedEntities(parsedRemote.employees) : [];
        
        const empMap = new Map();
        remoteEmps.forEach(emp => {
          if (emp && (emp.id || emp.name)) {
            empMap.set(String(emp.id || emp.name), { ...emp });
          }
        });

        localEmps.forEach(lEmp => {
          if (!lEmp || (!lEmp.id && !lEmp.name)) return;
          const eKey = String(lEmp.id || lEmp.name);
          if (empMap.has(eKey)) {
            const rEmp = empMap.get(eKey);
            const mergedEmp = {
              ...rEmp,
              ...lEmp,
              idFront: lEmp.idFront || rEmp.idFront || '',
              idBack: lEmp.idBack || rEmp.idBack || '',
              machines: (Array.isArray(lEmp.machines) && lEmp.machines.length > 0) ? lEmp.machines : (rEmp.machines || []),
              salaryAmount: (lEmp.salaryAmount !== undefined && lEmp.salaryAmount !== null && lEmp.salaryAmount !== '') ? lEmp.salaryAmount : rEmp.salaryAmount
            };
            empMap.set(eKey, mergedEmp);
          } else {
            // Only preserve fresh local addition created in the last 60s or if remote had 0 employees
            const isFresh = lEmp.createdAt && (Date.now() - new Date(lEmp.createdAt).getTime() < 60000);
            if (isFresh || remoteEmps.length === 0) {
              empMap.set(eKey, lEmp);
            }
          }
        });

        const mergedEmployees = filterDeletedEntities(Array.from(empMap.values()));

        // Merge machines
        const localMachines = Array.isArray(parsedLocal.machines) ? filterDeletedEntities(parsedLocal.machines) : [];
        const remoteMachines = Array.isArray(parsedRemote.machines) ? filterDeletedEntities(parsedRemote.machines) : [];
        const machineMap = new Map();
        remoteMachines.forEach(m => { if (m && (m.id || m.name)) machineMap.set(String(m.id || m.name), m); });
        localMachines.forEach(lM => {
          if (lM && (lM.id || lM.name)) {
            const mKey = String(lM.id || lM.name);
            if (!machineMap.has(mKey)) {
              if (remoteMachines.length === 0) machineMap.set(mKey, lM);
            } else {
              machineMap.set(mKey, { ...machineMap.get(mKey), ...lM });
            }
          }
        });
        const mergedMachines = filterDeletedEntities(Array.from(machineMap.values()));

        // Merge loans
        const localLoans = Array.isArray(parsedLocal.loans) ? filterDeletedEntities(parsedLocal.loans) : [];
        const remoteLoans = Array.isArray(parsedRemote.loans) ? filterDeletedEntities(parsedRemote.loans) : [];
        const loanMap = new Map();
        remoteLoans.forEach(ln => { if (ln && ln.id) loanMap.set(String(ln.id), ln); });
        localLoans.forEach(ln => {
          if (ln && ln.id) {
            if (!loanMap.has(String(ln.id))) {
              if (remoteLoans.length === 0) loanMap.set(String(ln.id), ln);
            } else {
              loanMap.set(String(ln.id), { ...loanMap.get(String(ln.id)), ...ln });
            }
          }
        });
        const mergedLoans = filterDeletedEntities(Array.from(loanMap.values()));

        // Attendance merging: local edits within 3s merge over remote
        const remoteAtt = (parsedRemote.attendance && typeof parsedRemote.attendance === 'object') ? parsedRemote.attendance : {};
        const localAtt = (parsedLocal.attendance && typeof parsedLocal.attendance === 'object') ? parsedLocal.attendance : {};
        const mergedAttendance = { ...remoteAtt };
        Object.entries(localAtt).forEach(([dateKey, lEmps]) => {
          if (!mergedAttendance[dateKey]) {
            mergedAttendance[dateKey] = lEmps;
          } else {
            mergedAttendance[dateKey] = { ...mergedAttendance[dateKey], ...lEmps };
          }
        });

        // Merge salary settlements
        const mergedSalaryPayments = {
          ...(parsedRemote.salaryPayments || {}),
          ...(parsedLocal.salaryPayments || {})
        };

        return {
          ...parsedRemote,
          ...parsedLocal,
          employees: mergedEmployees,
          machines: mergedMachines,
          loans: mergedLoans,
          attendance: mergedAttendance,
          salaryPayments: mergedSalaryPayments
        };
      }

      const targetObj = isLocallyActive ? parsedLocal : parsedRemote;
      // If object has employees/machines/loans arrays (like STATE_KEY aethertasks_db_state_v7)
      if (targetObj && (Array.isArray(targetObj.employees) || Array.isArray(targetObj.machines) || Array.isArray(targetObj.loans))) {
        const cloned = { ...targetObj };
        if (Array.isArray(cloned.employees)) cloned.employees = filterDeletedEntities(cloned.employees);
        if (Array.isArray(cloned.machines)) cloned.machines = filterDeletedEntities(cloned.machines);
        if (Array.isArray(cloned.loans)) cloned.loans = filterDeletedEntities(cloned.loans);
        return cloned;
      }
      return targetObj;
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

    // Check if user is actively typing in a form input or textarea
    const activeEl = document.activeElement;
    const isActivelyTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);

    if (timeSinceLastWrite < 1500 && isActivelyTyping) {
      // User is actively typing into an input field on this workstation. Defer application briefly!
      pendingRemoteUpdates[key] = valStr;
      clearTimeout(deferredApplyTimers[key]);
      deferredApplyTimers[key] = setTimeout(() => {
        const currentElapsed = Date.now() - (lastLocalWrites[key] || 0);
        if (currentElapsed >= 1500 && pendingRemoteUpdates[key]) {
          const deferredVal = pendingRemoteUpdates[key];
          delete pendingRemoteUpdates[key];
          applyRemoteKeyUpdate(key, deferredVal);
        }
      }, (1500 - timeSinceLastWrite) + 100);
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
    if (typeof window !== 'undefined' && typeof window.__vf_broadcastActiveFormSnapshot === 'function') {
      setTimeout(() => {
        try { window.__vf_broadcastActiveFormSnapshot(); } catch(e) {}
      }, 300);
    }
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
    if (typeof window !== 'undefined' && typeof window.__vf_broadcastActiveFormSnapshot === 'function') {
      setTimeout(() => {
        try { window.__vf_broadcastActiveFormSnapshot(); } catch(e) {}
      }, 400);
    }
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
    } else if (activeConfig.isConfigured && (!ws || ws.readyState === WebSocket.CLOSED)) {
      initRealtimeWebSocket();
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
    } else if (activeConfig.isConfigured && (!ws || ws.readyState === WebSocket.CLOSED)) {
      initRealtimeWebSocket();
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

  function broadcastFormClear(fieldIds = []) {
    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const payload = {
      type: 'form_clear',
      senderId: CLIENT_ID,
      user: user,
      page: page,
      tab: window.__vf_active_tab || '',
      fieldIds: Array.isArray(fieldIds) ? fieldIds : (fieldIds ? [fieldIds] : []),
      timestamp: Date.now()
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: 'form_clear',
            payload: payload
          },
          ref: 'fclr_' + Date.now()
        }));
      } catch(e) {}
    } else if (activeConfig.isConfigured && (!ws || ws.readyState === WebSocket.CLOSED)) {
      initRealtimeWebSocket();
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'form_clear',
          senderId: CLIENT_ID,
          payload: payload
        });
      } catch(e) {}
    }
  }

  // --- Realtime Collaborative Form & Input Field Synchronizer (Google Sheets Style with Live Field Locking) ---
  function initCollaborativeDOMSync() {
    const activeRemoteLocks = new Map(); // fieldId -> { tagEl, inputEl, user, timer, origReadOnly, origPointerEvents }
    const fieldDebounceTimers = new Map();
    const lastLocalFieldWrites = new Map();

    function getFieldIdentifier(el) {
      if (!el || !el.tagName) return null;
      const tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return null;
      if (el.type === 'password' || el.type === 'hidden' || el.type === 'file') return null;
      
      // ONLY broadcast collaborative sync for elements explicitly opting in via data-collab-sync="true"
      if (!el.dataset || el.dataset.collabSync !== 'true') return null;

      if (el.dataset.collabId) return el.dataset.collabId;
      if (el.id && !el.id.startsWith('__')) return el.id;
      if (el.name) return el.name;

      const rowEl = el.closest('[data-row-id], [data-item-id], [data-id], tr, li, .card, .product-card');
      const rowKey = rowEl ? (rowEl.dataset.rowId || rowEl.dataset.itemId || rowEl.dataset.id || rowEl.id || Array.from(rowEl.parentElement ? rowEl.parentElement.children : []).indexOf(rowEl)) : 'form';
      const fieldKey = el.getAttribute('aria-label') || el.placeholder || el.type || 'inp';
      return `${rowKey}__${fieldKey}`.replace(/\s+/g, '_');
    }

    function findElementByFieldId(fieldId) {
      if (!fieldId) return null;
      try {
        let el = document.getElementById(fieldId);
        if (el) return el;

        const safeEscape = (str) => {
          try {
            return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(str) : String(str).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
          } catch(e) {
            return String(str);
          }
        };

        el = document.querySelector(`[data-collab-id="${safeEscape(fieldId)}"]`);
        if (el) return el;

        el = document.querySelector(`[name="${safeEscape(fieldId)}"]`);
        if (el) return el;

        if (fieldId.includes('__')) {
          const [rowKey, fieldKey] = fieldId.split('__');
          const row = document.getElementById(rowKey) || document.querySelector(`[data-row-id="${safeEscape(rowKey)}"], [data-item-id="${safeEscape(rowKey)}"], [data-id="${safeEscape(rowKey)}"]`);
          if (row) {
            el = row.querySelector(`[name="${safeEscape(fieldKey)}"], [placeholder="${safeEscape(fieldKey)}"], [aria-label="${safeEscape(fieldKey)}"]`);
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

    function unlockField(fieldId) {
      if (!activeRemoteLocks.has(fieldId)) return;
      const info = activeRemoteLocks.get(fieldId);
      clearTimeout(info.timer);
      if (info.tagEl && info.tagEl.parentElement) {
        info.tagEl.style.opacity = '0';
        info.tagEl.style.transform = 'translateY(4px)';
        setTimeout(() => { try { info.tagEl.remove(); } catch(e) {} }, 180);
      }
      if (info.inputEl) {
        info.inputEl.classList.remove('vf-collab-focus-ring', 'vf-collab-locked-field');
        info.inputEl.style.removeProperty('--vf-collab-color');
        info.inputEl.style.removeProperty('--vf-collab-glow');
        info.inputEl.removeAttribute('data-vf-locked-by');
        info.inputEl.removeAttribute('title');
        
        // Restore interaction
        if (info.origReadOnly !== undefined) {
          info.inputEl.readOnly = info.origReadOnly;
        } else {
          info.inputEl.readOnly = false;
        }
        if (info.origPointerEvents !== undefined) {
          info.inputEl.style.pointerEvents = info.origPointerEvents;
        } else {
          info.inputEl.style.removeProperty('pointer-events');
        }
      }
      activeRemoteLocks.delete(fieldId);
    }

    function lockFieldForRemoteUser(fieldId, user) {
      const el = findElementByFieldId(fieldId);
      if (!el) return;

      // If local user is currently on this element, yield focus to the remote editor
      if (document.activeElement === el) {
        try { el.blur(); } catch(e) {}
      }

      // Clean up previous lock if any
      unlockField(fieldId);

      const color = user.color || { bg: '#8b5cf6', fg: '#ffffff', glow: 'rgba(139,92,246,0.35)' };
      const origReadOnly = el.readOnly;
      const origPointerEvents = el.style.pointerEvents;

      el.classList.add('vf-collab-focus-ring', 'vf-collab-locked-field');
      el.style.setProperty('--vf-collab-color', color.bg);
      el.style.setProperty('--vf-collab-glow', color.glow || 'rgba(139,92,246,0.35)');
      el.setAttribute('data-vf-locked-by', user.name || 'User');
      el.setAttribute('title', `🔒 Locked: ${user.name || 'User'} is entering data...`);

      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'select') {
        el.style.pointerEvents = 'none';
      } else {
        el.readOnly = true;
      }

      const tagEl = document.createElement('div');
      tagEl.className = 'vf-collab-editor-tag';
      tagEl.style.setProperty('--vf-collab-color', color.bg);
      tagEl.innerHTML = `
        <span style="font-size:0.7rem; line-height: 1;">🔒</span>
        <span style="font-weight: 700;">${escapeHtmlStr(user.name || 'User')}</span>
        <span style="opacity: 0.85; font-size: 0.65rem;">is editing</span>
      `;

      const parent = el.parentElement;
      if (parent) {
        const computedPos = window.getComputedStyle(parent).position;
        if (computedPos === 'static') {
          parent.style.position = 'relative';
        }
        parent.appendChild(tagEl);
      }

      // Safety timeout: auto-unlock after 2.5 seconds of inactivity if blur was missed
      const timer = setTimeout(() => {
        unlockField(fieldId);
      }, 2500);

      activeRemoteLocks.set(fieldId, {
        tagEl: tagEl,
        inputEl: el,
        user: user,
        timer: timer,
        origReadOnly: origReadOnly,
        origPointerEvents: origPointerEvents
      });
    }

    // Local user focus & typing broadcasters (ONLY triggers on genuine trusted user interactions)
    document.addEventListener('focusin', (e) => {
      const fid = getFieldIdentifier(e.target);
      if (fid) {
        unlockField(fid); // Immediately clear any stale remote lock for local user
      }
      if (!e.isTrusted) return;
      if (!fid) return;
      broadcastFieldFocus(fid, true, {
        label: e.target.placeholder || e.target.name || ''
      });
    }, true);

    document.addEventListener('focusout', (e) => {
      if (!e.isTrusted) return;
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      broadcastFieldFocus(fid, false);
    }, true);

    document.addEventListener('input', (e) => {
      if (!e.isTrusted) return; // Prevent synthetic events from echoing into broadcast loop
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      const val = e.target.value;
      lastLocalFieldWrites.set(fid, Date.now());

      if (fieldDebounceTimers.has(fid)) {
        clearTimeout(fieldDebounceTimers.get(fid));
      }

      // Fast-flush (0ms for empty/cleared, 10ms on typing) for instantaneous live peer reflection
      const delay = (val === '') ? 0 : 10;
      const timer = setTimeout(() => {
        broadcastFieldChange(fid, val, {
          label: e.target.placeholder || e.target.name || ''
        });
        fieldDebounceTimers.delete(fid);
      }, delay);
      fieldDebounceTimers.set(fid, timer);
    }, true);

    document.addEventListener('change', (e) => {
      if (!e.isTrusted) return;
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      const val = e.target.value;
      lastLocalFieldWrites.set(fid, Date.now());

      if (fieldDebounceTimers.has(fid)) {
        clearTimeout(fieldDebounceTimers.get(fid));
        fieldDebounceTimers.delete(fid);
      }
      broadcastFieldChange(fid, val, {
        label: e.target.placeholder || e.target.name || ''
      });
    }, true);

    // Incoming Remote Field Focus Handler (Google Sheets Style Single-Field Locking)
    window.addEventListener('supabase-field-focus', (e) => {
      const { fieldId, isFocused, user, senderId } = e.detail || {};
      if (!fieldId || senderId === CLIENT_ID) return;

      if (isFocused && user) {
        lockFieldForRemoteUser(fieldId, user);
      } else {
        unlockField(fieldId);
      }
    });

    // Incoming Remote Field Change Handler (Live Keystrokes & Live Values)
    window.addEventListener('supabase-field-change', (e) => {
      const { fieldId, value, user, senderId, meta } = e.detail || {};
      if (!fieldId || value === undefined || value === null || senderId === CLIENT_ID) return;

      const el = findElementByFieldId(fieldId);
      if (!el) return;

      // If incoming remote change is for this element and local user had cursor, yield focus to remote editor
      if (document.activeElement === el && !meta?.isSnapshot) {
        try { el.blur(); } catch(e) {}
      }

      // Refresh auto-unlock timeout only if this field is already actively locked by focus
      if (activeRemoteLocks.has(fieldId)) {
        const lockInfo = activeRemoteLocks.get(fieldId);
        clearTimeout(lockInfo.timer);
        lockInfo.timer = setTimeout(() => {
          unlockField(fieldId);
        }, 2500);
      }

      if (String(el.value) !== String(value)) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ? 
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set : null;
        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ?
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set : null;
        const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value') ?
          Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set : null;
        
        try {
          if (tag === 'input' && nativeInputValueSetter) {
            nativeInputValueSetter.call(el, value);
          } else if (tag === 'textarea' && nativeTextAreaValueSetter) {
            nativeTextAreaValueSetter.call(el, value);
          } else if (tag === 'select' && nativeSelectValueSetter) {
            nativeSelectValueSetter.call(el, value);
          } else {
            el.value = value;
          }
        } catch(err) {
          el.value = value;
        }

        // Direct guarantee
        el.value = value;

        // Trigger local UI reactivity (calculations, previews, dropdown dependents) without echoing back
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
      }
    });

    // Incoming Remote Form Clear Handler
    window.addEventListener('supabase-form-clear', (e) => {
      const { fieldIds, senderId } = e.detail || {};
      if (senderId === CLIENT_ID) return;

      if (Array.isArray(fieldIds) && fieldIds.length > 0) {
        fieldIds.forEach(fid => {
          unlockField(fid);
          const el = findElementByFieldId(fid);
          if (el && el !== document.activeElement) {
            el.value = '';
            try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
            try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
          }
        });
      } else {
        // Unlock all active locks if broad form clear
        Array.from(activeRemoteLocks.keys()).forEach(fid => unlockField(fid));
      }
    });

    // Function to broadcast all currently filled input fields so new/joining users immediately see active entry data
    function broadcastActiveFormSnapshot(container) {
      try {
        const root = (container && typeof container.querySelectorAll === 'function') ? container : document;
        const inputs = root.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="file"]), textarea, select');
        inputs.forEach(el => {
          const fid = getFieldIdentifier(el);
          // CRITICAL: Only broadcast NON-EMPTY values during snapshot catchup so blank/fresh forms never overwrite active peer data
          if (fid && el.value !== undefined && el.value !== null && String(el.value).trim() !== '') {
            broadcastFieldChange(fid, el.value, {
              label: el.placeholder || el.name || '',
              isSnapshot: true
            });
          }
        });
        if (document.activeElement && (!container || container.contains(document.activeElement))) {
          const fid = getFieldIdentifier(document.activeElement);
          if (fid && document.activeElement.value && String(document.activeElement.value).trim() !== '') {
            broadcastFieldFocus(fid, true, {
              label: document.activeElement.placeholder || document.activeElement.name || ''
            });
          }
        }
      } catch(e) {}
    }
    window.__vf_broadcastActiveFormSnapshot = broadcastActiveFormSnapshot;
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

  function handleIncomingFormClear(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      window.dispatchEvent(new CustomEvent('supabase-form-clear', { detail: payload }));
    } catch(e) {}
  }

  function handleIncomingItemDeleted(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      const { key, itemId, itemIds, aliases } = payload;
      const allTargetIds = [
        ...(Array.isArray(itemIds) ? itemIds : []),
        ...(Array.isArray(aliases) ? aliases : []),
        ...(itemId ? [itemId] : [])
      ].map(String).map(s => s.trim()).filter(Boolean);

      if (allTargetIds.length > 0) {
        let deletedIds = getDeletedTombstones();
        let changed = false;
        allTargetIds.forEach(idStr => {
          if (!deletedIds.includes(idStr)) {
            deletedIds.push(idStr);
            changed = true;
          }
        });
        if (changed) {
          if (deletedIds.length > 5000) deletedIds = deletedIds.slice(-5000);
          const valStr = JSON.stringify(deletedIds);
          cache['vf_deleted_entity_ids'] = valStr;
          cache['vf_deleted_costing_ids'] = valStr;
          safeLocalStorageSet('vf_deleted_entity_ids', valStr);
          safeLocalStorageSet('vf_deleted_costing_ids', valStr);
        }

        // Clean from all known entity keys in cache immediately
        const entityKeys = [
          'yarn_sales_ledger_data', 'yarn_purchase_ledger_data',
          'yarn-qualities', 'yarn-fp-qualities', 'yarn-suppliers', 'manage-looms', 'manage-jacquards', 'manage-jalas', 'manage-fanis', 'machines',
          'yarn_covering_production_logs', 'yarn_tfo_production_logs', 'yarn_doubler_production_logs',
          'yarn_covering_sales_logs', 'yarn_tfo_sales_logs', 'yarn_doubler_sales_logs',
          'warp-beams', 'warp-issues', 'yarn-issues', 'yarn-rm-orders', 'warp-beam-loadings'
        ];
        if (key && !entityKeys.includes(key)) entityKeys.push(key);

        entityKeys.forEach(k => {
          if (cache[k]) {
            try {
              const parsed = JSON.parse(cache[k]);
              if (Array.isArray(parsed)) {
                const filtered = filterDeletedEntities(parsed);
                const newStr = JSON.stringify(filtered);
                if (cache[k] !== newStr) {
                  cache[k] = newStr;
                  safeLocalStorageSet(k, newStr);
                  window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: k, value: newStr, isRemote: true } }));
                }
              }
            } catch(e) {}
          }
        });

        // Clean from state objects (e.g. aethertasks_db_state_v7, staff-salary-state)
        ['aethertasks_db_state_v7', 'staff-salary-state'].forEach(sKey => {
          const raw = cache[sKey] || nativeLocalStorage.getItem(sKey);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object') {
                let stateChanged = false;
                if (Array.isArray(parsed.employees)) {
                  const origLen = parsed.employees.length;
                  parsed.employees = filterDeletedEntities(parsed.employees);
                  if (parsed.employees.length !== origLen) stateChanged = true;
                }
                if (Array.isArray(parsed.machines)) {
                  const origLen = parsed.machines.length;
                  parsed.machines = filterDeletedEntities(parsed.machines);
                  if (parsed.machines.length !== origLen) stateChanged = true;
                }
                if (Array.isArray(parsed.loans)) {
                  const origLen = parsed.loans.length;
                  parsed.loans = filterDeletedEntities(parsed.loans);
                  if (parsed.loans.length !== origLen) stateChanged = true;
                }
                if (stateChanged) {
                  const newStr = JSON.stringify(parsed);
                  cache[sKey] = newStr;
                  safeLocalStorageSet(sKey, newStr);
                  window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: sKey, value: newStr, isRemote: true } }));
                }
              }
            } catch(e) {}
          }
        });
      }
      window.dispatchEvent(new CustomEvent('supabase-item-deleted', { detail: payload }));
      window.dispatchEvent(new Event('storage'));
    } catch(e) {}
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
        } else if (type === 'form_clear' && payload) {
          handleIncomingFormClear(payload);
        } else if (type === 'item_deleted' && payload) {
          handleIncomingItemDeleted(payload);
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
            } else if (eventType === 'form_clear') {
              handleIncomingFormClear(inner);
            } else if (eventType === 'item_deleted') {
              handleIncomingItemDeleted(inner);
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
    async getMultiple(keys) {
      if (!Array.isArray(keys) || keys.length === 0) return {};
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return {};
      try {
        const encoded = keys.map(k => `"${encodeURIComponent(k)}"`).join(',');
        const res = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=in.(${encoded})&select=key,value`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (!res.ok) return {};
        const rows = await res.json();
        const map = {};
        if (Array.isArray(rows)) {
          rows.forEach(r => {
            if (r && r.key) {
              map[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
            }
          });
        }
        return map;
      } catch (e) {
        console.error('Supabase getMultiple error:', e);
        return {};
      }
    },
    saveToSupabase(key, value, isImmediate = true) {
      return this.set(key, value, isImmediate);
    },
    // Debounced and Hash-Guarded Persistent Database Write (Zero Wasted POST Quota)
    set(key, value, isImmediate = false) {
      if (isLocalOnlyKey(key)) return false;
      const valStr = typeof value === 'string' ? value : JSON.stringify(value);
      // Guard against pre-hydration empty state overwriting cloud tables
      if (!isHydrated && (valStr === '[]' || valStr === '{}')) {
        return false;
      }
      try {
        lastLocalWrites[key] = Date.now();

        const nowIso = new Date().toISOString();
        const payloadHash = computeHash(valStr);

        // Always update in-memory cache and safe local storage synchronously for this client
        cache[key] = valStr;
        safeLocalStorageSet(key, valStr);

        // Broadcast immediately over Realtime WebSocket & BroadcastChannel (instant sub-50ms sync, 0 DB queries)
        broadcastRealtimeUpdate(key, value);

        // Always clear pending debounced write timer for this key immediately
        clearTimeout(debouncedWriteTimers[key]);

        // Check if unchanged on remote DB to avoid redundant database writes
        if (lastSavedHashes[key] === payloadHash) {
          return true;
        }

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

            // Dedicated Relational Synchronization for RM Qualities
            if (key === 'yarn-qualities' && Array.isArray(value)) {
              try {
                const cleanValue = filterDeletedEntities(value);
                const qRows = cleanValue.filter(q => q && q.id).map(q => ({
                  id: String(q.id),
                  quality: String(q.quality || ''),
                  code: String(q.code || ''),
                  color: String(q.color || ''),
                  type: String(q.type || 'Polyester'),
                  supplier: String(q.supplier || ''),
                  created_at: q.createdAt || nowIso,
                  updated_at: nowIso
                }));

                if (qRows.length > 0) {
                  for (let i = 0; i < qRows.length; i += 300) {
                    const chunk = qRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_rm_qualities?on_conflict=id`, {
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
                  try {
                    const dbExisting = await fetchAllRowsPaginated('vf_rm_qualities', 'id');
                    if (Array.isArray(dbExisting)) {
                      const validIdSet = new Set(qRows.map(r => String(r.id).toLowerCase()));
                      const toDelete = dbExisting.filter(d => d && d.id && !validIdSet.has(String(d.id).toLowerCase()));
                      toDelete.forEach(d => {
                        const encId = encodeURIComponent(d.id);
                        fetch(`${SUPABASE_URL}/rest/v1/vf_rm_qualities?id=eq.${encId}`, {
                          method: 'DELETE',
                          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                        }).catch(() => {});
                      });
                    }
                  } catch(delErr) {}
                } else if (cleanValue.length === 0) {
                  fetch(`${SUPABASE_URL}/rest/v1/vf_rm_qualities`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                  }).catch(() => {});
                }
              } catch(e) {
                console.warn('RM Qualities relational sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for FP Qualities
            if (key === 'yarn-fp-qualities' && Array.isArray(value)) {
              try {
                const cleanValue = filterDeletedEntities(value);
                const fpRows = cleanValue.filter(q => q && q.id).map(q => ({
                  id: String(q.id),
                  division: String(q.division || 'covering'),
                  name: String(q.name || ''),
                  composition: q.composition || '',
                  yarns: Array.isArray(q.yarns) ? q.yarns : [],
                  denier: q.denier !== '' && q.denier !== null && !isNaN(q.denier) ? Number(q.denier) : null,
                  tpm: q.tpm !== '' && q.tpm !== null && !isNaN(q.tpm) ? parseInt(q.tpm, 10) : null,
                  twist: q.twist || '',
                  color: q.color || '',
                  created_at: q.createdAt || nowIso,
                  updated_at: nowIso
                }));

                if (fpRows.length > 0) {
                  for (let i = 0; i < fpRows.length; i += 300) {
                    const chunk = fpRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_fp_qualities?on_conflict=id`, {
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
                  try {
                    const dbExisting = await fetchAllRowsPaginated('vf_fp_qualities', 'id');
                    if (Array.isArray(dbExisting)) {
                      const validIdSet = new Set(fpRows.map(r => String(r.id).toLowerCase()));
                      const toDelete = dbExisting.filter(d => d && d.id && !validIdSet.has(String(d.id).toLowerCase()));
                      toDelete.forEach(d => {
                        const encId = encodeURIComponent(d.id);
                        fetch(`${SUPABASE_URL}/rest/v1/vf_fp_qualities?id=eq.${encId}`, {
                          method: 'DELETE',
                          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                        }).catch(() => {});
                      });
                    }
                  } catch(delErr) {}
                } else if (cleanValue.length === 0) {
                  fetch(`${SUPABASE_URL}/rest/v1/vf_fp_qualities`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                  }).catch(() => {});
                }
              } catch(e) {
                console.warn('FP Qualities relational sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for RM Suppliers
            if (key === 'yarn-suppliers' && Array.isArray(value)) {
              try {
                const cleanValue = filterDeletedEntities(value);
                const sRows = cleanValue.filter(s => s && s.id).map(s => ({
                  id: String(s.id),
                  name: String(s.name || ''),
                  phone: s.phone || '',
                  email: s.email || '',
                  address: s.address || '',
                  notes: s.notes || '',
                  created_at: s.createdAt || nowIso,
                  updated_at: nowIso
                }));

                if (sRows.length > 0) {
                  for (let i = 0; i < sRows.length; i += 300) {
                    const chunk = sRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_rm_suppliers?on_conflict=id`, {
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
                  try {
                    const dbExisting = await fetchAllRowsPaginated('vf_rm_suppliers', 'id');
                    if (Array.isArray(dbExisting)) {
                      const validIdSet = new Set(sRows.map(r => String(r.id).toLowerCase()));
                      const toDelete = dbExisting.filter(d => d && d.id && !validIdSet.has(String(d.id).toLowerCase()));
                      toDelete.forEach(d => {
                        const encId = encodeURIComponent(d.id);
                        fetch(`${SUPABASE_URL}/rest/v1/vf_rm_suppliers?id=eq.${encId}`, {
                          method: 'DELETE',
                          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                        }).catch(() => {});
                      });
                    }
                  } catch(delErr) {}
                } else if (cleanValue.length === 0) {
                  fetch(`${SUPABASE_URL}/rest/v1/vf_rm_suppliers`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                  }).catch(() => {});
                }
              } catch(e) {
                console.warn('RM Suppliers relational sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Yarn RM Stock Book
            if (key === 'vishwa_yarn_rm_stock_data' && Array.isArray(value)) {
              try {
                const lotRows = [];
                const boxRows = [];

                value.forEach(lot => {
                  if (!lot || !lot.id) return;
                  const lotId = String(lot.id);
                  const boxes = Array.isArray(lot.boxes) ? lot.boxes : [];
                  const grossWt = boxes.reduce((sum, b) => sum + (parseFloat(b.grossWeight) || parseFloat(b.weight) || 0), 0);

                  lotRows.push({
                    id: lotId,
                    batch_id: lot.batchId || null,
                    lot_number: String(lot.lotNumber || lot.id || 'LOT-AUTO'),
                    challan_number: String(lot.challanNo || lot.challanNumber || ''),
                    receive_date: (lot.receiveDate || lot.date || new Date().toISOString().split('T')[0]).split('T')[0],
                    supplier: String(lot.supplier || ''),
                    quality: String(lot.quality || ''),
                    item_type: String(lot.itemType || lot.category || 'Polyester'),
                    code: String(lot.code || ''),
                    color: String(lot.color || ''),
                    rate: parseFloat(lot.rate || lot.price) || 0,
                    order_ref: String(lot.orderRef || ''),
                    total_boxes: boxes.length,
                    gross_weight: parseFloat(grossWt.toFixed(2)),
                    notes: lot.notes || '',
                    updated_at: nowIso
                  });

                  boxes.forEach((b, bIdx) => {
                    const boxId = String(b.id || b.boxNumber || `B${bIdx + 1}`).trim();
                    const bUid = `${lotId}__${boxId}`;
                    const bGross = parseFloat(b.grossWeight) || parseFloat(b.weight) || 0;
                    const bGr = parseFloat(b.grWeight || b.returnedWeight) || 0;
                    const bRem = b.remainingWeight !== undefined ? parseFloat(b.remainingWeight) : Math.max(0, bGross - bGr);
                    const bActive = parseFloat(b.weight) || (b.status === 'gr' ? bGross : bRem);

                    boxRows.push({
                      id: bUid,
                      lot_id: lotId,
                      box_number: boxId,
                      cones: parseInt(b.cones, 10) || 0,
                      gross_weight: parseFloat(bGross.toFixed(2)),
                      remaining_weight: parseFloat(bRem.toFixed(2)),
                      active_weight: parseFloat(bActive.toFixed(2)),
                      status: b.status === 'issued' ? 'issued' : (b.status === 'gr' ? 'gr' : 'available'),
                      issue_date: (b.status === 'issued' && b.issueDate) ? String(b.issueDate).split('T')[0] : null,
                      issued_to: (b.status === 'issued') ? (b.issuedTo || null) : null,
                      gr_date: b.grDate ? String(b.grDate).split('T')[0] : null,
                      gr_weight: parseFloat(bGr.toFixed(2)),
                      gr_remarks: b.grRemarks || null,
                      updated_at: nowIso
                    });
                  });
                });

                if (lotRows.length > 0) {
                  for (let i = 0; i < lotRows.length; i += 200) {
                    const chunk = lotRows.slice(i, i + 200);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_lots?on_conflict=id`, {
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

                if (boxRows.length > 0) {
                  for (let i = 0; i < boxRows.length; i += 500) {
                    const chunk = boxRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_boxes?on_conflict=id`, {
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

                // Clean up removed boxes and lots from Supabase
                const activeLotIds = lotRows.map(l => l.id);
                for (const lId of activeLotIds) {
                  const currentBoxIdsForLot = boxRows.filter(b => b.lot_id === lId).map(b => b.id);
                  if (currentBoxIdsForLot.length > 0) {
                    const bIdsList = currentBoxIdsForLot.map(id => `"${id}"`).join(',');
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_boxes?lot_id=eq.${encodeURIComponent(lId)}&id=not.in.(${bIdsList})`, {
                      method: 'DELETE',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                      }
                    }).catch(() => {});
                  } else {
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_boxes?lot_id=eq.${encodeURIComponent(lId)}`, {
                      method: 'DELETE',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                      }
                    }).catch(() => {});
                  }
                }
                if (activeLotIds.length > 0) {
                  const lIdsList = activeLotIds.map(id => `"${id}"`).join(',');
                  await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_lots?id=not.in.(${lIdsList})`, {
                    method: 'DELETE',
                    headers: {
                      'apikey': SUPABASE_ANON_KEY,
                      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                    }
                  }).catch(() => {});
                } else if (value.length === 0 && isHydrated) {
                  await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_boxes`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                  }).catch(() => {});
                  await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_lots`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                  }).catch(() => {});
                }
              } catch(e) {
                console.warn('Yarn RM Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Yarn RM Orders
            if (key === 'yarn-rm-orders' && Array.isArray(value)) {
              try {
                const orderRows = [];
                const batchRows = [];
                const boxRows = [];

                value.forEach(order => {
                  if (!order || !order.id) return;
                  const orderId = String(order.id);
                  const orderNum = String(order.orderNumber || order.id || 'YRN-AUTO');
                  const orderDate = (order.orderDate || order.createdAt || new Date().toISOString().split('T')[0]).split('T')[0];

                  orderRows.push({
                    id: orderId,
                    order_number: orderNum,
                    order_date: orderDate,
                    supplier: String(order.supplier || ''),
                    category: String(order.category || order.type || 'Polyester'),
                    quality: String(order.quality || ''),
                    code: String(order.code || ''),
                    color: String(order.color || ''),
                    ordered_weight: parseFloat(order.orderedWeight) || 0,
                    price: parseFloat(order.price) || 0,
                    status: order.status === 'Completed' ? 'Completed' : (order.status === 'Cancelled' ? 'Cancelled' : 'Active'),
                    remarks: order.remarks || order.notes || '',
                    updated_at: nowIso
                  });

                  (order.batches || []).forEach((batch, bIdx) => {
                    if (!batch) return;
                    const batchId = String(batch.id || `${orderId}__BATCH-${bIdx}`);
                    const bChallan = String(batch.challanNumber || '').trim();
                    const bLot = String(batch.lotNumber || '').trim();
                    const bDate = (batch.receiveDate || orderDate).split('T')[0];
                    const bBoxes = Array.isArray(batch.boxes) ? batch.boxes : [];
                    const bTotalWeight = parseFloat(batch.totalWeight) || bBoxes.reduce((sum, bx) => sum + (parseFloat(bx.weight) || 0), 0);

                    batchRows.push({
                      id: batchId,
                      order_id: orderId,
                      challan_number: bChallan,
                      lot_number: bLot,
                      receive_date: bDate,
                      total_weight: parseFloat(bTotalWeight.toFixed(2)),
                      notes: batch.notes || '',
                      updated_at: nowIso
                    });

                    bBoxes.forEach((bx, bxIdx) => {
                      const boxNum = String(bx.boxNumber || `B${bxIdx + 1}`).trim();
                      const boxUid = `${batchId}__${boxNum}`;
                      boxRows.push({
                        id: boxUid,
                        batch_id: batchId,
                        order_id: orderId,
                        box_number: boxNum,
                        weight: parseFloat(bx.weight) || 0,
                        cones: parseInt(bx.cones, 10) || 0,
                        returned_weight: parseFloat(bx.returnedWeight) || 0,
                        returned_date: bx.returnedDate ? String(bx.returnedDate).split('T')[0] : null,
                        return_reason: bx.returnReason || null,
                        updated_at: nowIso
                      });
                    });
                  });
                });

                if (orderRows.length > 0) {
                  for (let i = 0; i < orderRows.length; i += 200) {
                    const chunk = orderRows.slice(i, i + 200);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_orders?on_conflict=id`, {
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

                if (batchRows.length > 0) {
                  for (let i = 0; i < batchRows.length; i += 300) {
                    const chunk = batchRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_batches?on_conflict=id`, {
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

                if (boxRows.length > 0) {
                  for (let i = 0; i < boxRows.length; i += 500) {
                    const chunk = boxRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_boxes?on_conflict=id`, {
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

                // Clean up removed boxes, batches, and orders from Supabase
                const activeBatchIds = batchRows.map(b => b.id);
                for (const bId of activeBatchIds) {
                  const currentBoxIdsForBatch = boxRows.filter(bx => bx.batch_id === bId).map(bx => bx.id);
                  if (currentBoxIdsForBatch.length > 0) {
                    const idsList = currentBoxIdsForBatch.map(id => `"${id}"`).join(',');
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_boxes?batch_id=eq.${encodeURIComponent(bId)}&id=not.in.(${idsList})`, {
                      method: 'DELETE',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                      }
                    }).catch(() => {});
                  } else {
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_boxes?batch_id=eq.${encodeURIComponent(bId)}`, {
                      method: 'DELETE',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                      }
                    }).catch(() => {});
                  }
                }

                const activeOrderIds = orderRows.map(o => o.id);
                for (const oId of activeOrderIds) {
                  const currentBatchIdsForOrder = batchRows.filter(b => b.order_id === oId).map(b => b.id);
                  if (currentBatchIdsForOrder.length > 0) {
                    const bIdsList = currentBatchIdsForOrder.map(id => `"${id}"`).join(',');
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_batches?order_id=eq.${encodeURIComponent(oId)}&id=not.in.(${bIdsList})`, {
                      method: 'DELETE',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                      }
                    }).catch(() => {});
                  } else {
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_batches?order_id=eq.${encodeURIComponent(oId)}`, {
                      method: 'DELETE',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                      }
                    }).catch(() => {});
                  }
                }

                if (activeOrderIds.length > 0) {
                  const oIdsList = activeOrderIds.map(id => `"${id}"`).join(',');
                  await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_orders?id=not.in.(${oIdsList})`, {
                    method: 'DELETE',
                    headers: {
                      'apikey': SUPABASE_ANON_KEY,
                      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                    }
                  }).catch(() => {});
                } else if (value.length === 0 && isHydrated) {
                  await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_boxes`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                  }).catch(() => {});
                  await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_batches`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                  }).catch(() => {});
                  await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_orders`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                  }).catch(() => {});
                }
              } catch(e) {
                console.warn('Yarn RM Orders Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Weft Yarn Issues
            if (key === 'yarn-issues' && Array.isArray(value) && value.length > 0) {
              try {
                const issueRows = value.map(iss => {
                  if (!iss) return null;
                  const issId = String(iss.id || `ISS-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const issDate = (iss.date || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: issId,
                    date: issDate,
                    quality: String(iss.quality || ''),
                    supplier: String(iss.supplier || iss.company || ''),
                    code: iss.code ? String(iss.code) : null,
                    color: iss.color ? String(iss.color) : null,
                    box: String(iss.box || ''),
                    challan: iss.challan ? String(iss.challan) : null,
                    lot: iss.lot ? String(iss.lot) : null,
                    cones: parseFloat(iss.cones) || 0,
                    net: parseFloat(iss.net) || 0,
                    details: iss.details || null,
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (issueRows.length > 0) {
                  for (let i = 0; i < issueRows.length; i += 500) {
                    const chunk = issueRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_weft_issues?on_conflict=id`, {
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
              } catch(e) {
                console.warn('Weft Issues Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Warp Beams
            if (key === 'warp-beams' && Array.isArray(value) && value.length > 0) {
              try {
                const beamRows = value.map(b => {
                  if (!b || !b.beamNumber) return null;
                  const bId = String(b.id || `BEAM-${b.beamNumber}`);
                  const bCreated = (b.createdAt || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: bId,
                    beam_number: String(b.beamNumber).trim(),
                    quality: String(b.quality || ''),
                    code: b.code ? String(b.code) : null,
                    color: b.color ? String(b.color) : null,
                    meters: parseFloat(b.meters) || 0,
                    ends: parseInt(b.ends, 10) || 0,
                    status: String(b.status || 'Available'),
                    machine_number: b.machineNumber ? String(b.machineNumber) : null,
                    warping_person: b.warpingPerson || null,
                    created_at: bCreated,
                    history: Array.isArray(b.history) ? b.history : [],
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (beamRows.length > 0) {
                  for (let i = 0; i < beamRows.length; i += 300) {
                    const chunk = beamRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beams?on_conflict=id`, {
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
              } catch(e) {
                console.warn('Warp Beams Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Warp Yarn Issues
            if (key === 'warp-issues' && Array.isArray(value) && value.length > 0) {
              try {
                const warpIssRows = value.map(iss => {
                  if (!iss) return null;
                  const issId = String(iss.id || `WARP-ISS-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const issDate = (iss.date || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: issId,
                    date: issDate,
                    quality: String(iss.quality || ''),
                    code: iss.code ? String(iss.code) : null,
                    color: iss.color ? String(iss.color) : null,
                    issued_weight: parseFloat(iss.issuedWeight || iss.net) || 0,
                    details: iss.details || null,
                    supplier: iss.supplier ? String(iss.supplier) : null,
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (warpIssRows.length > 0) {
                  for (let i = 0; i < warpIssRows.length; i += 500) {
                    const chunk = warpIssRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_issues?on_conflict=id`, {
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
              } catch(e) {
                console.warn('Warp Issues Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Warp Beam Loadings
            if (key === 'warp-beam-loadings' && Array.isArray(value) && value.length > 0) {
              try {
                const loadingRows = value.map(bl => {
                  if (!bl) return null;
                  const blId = String(bl.id || `BL-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const blDate = (bl.date || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: blId,
                    date: blDate,
                    piecein: bl.piecein || null,
                    drawing_in: bl.drawingIn || null,
                    fani: bl.fani || null,
                    drop_pin_jog: bl.dropPinJog || null,
                    machine_number: bl.machineNumber ? String(bl.machineNumber) : null,
                    beam_number: bl.beamNumber ? String(bl.beamNumber) : null,
                    item_color: bl.itemColor || null,
                    meters: parseFloat(bl.meters) || 0,
                    ends: parseInt(bl.ends, 10) || 0,
                    rate: parseFloat(bl.rate) || 0,
                    payment_amount: parseFloat(bl.paymentAmount) || 0,
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (loadingRows.length > 0) {
                  for (let i = 0; i < loadingRows.length; i += 500) {
                    const chunk = loadingRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beam_loadings?on_conflict=id`, {
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
              } catch(e) {
                console.warn('Warp Beam Loadings Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Weaving Loom Production Logs
            if (key === 'productionLogs' && Array.isArray(value) && value.length > 0) {
              try {
                const prodRows = value.map(l => {
                  if (!l || !l.productionDate || !l.machineNumber) return null;
                  const logId = String(l.id || `PROD-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const prodDate = (l.productionDate || new Date().toISOString().split('T')[0]).split('T')[0];
                  const pissDate = l.pissingDate ? String(l.pissingDate).split('T')[0] : null;
                  const foldDate = l.foldingDate ? String(l.foldingDate).split('T')[0] : null;
                  return {
                    id: logId,
                    production_date: prodDate,
                    machine_number: String(l.machineNumber).trim(),
                    beam_number: l.beamNumber ? String(l.beamNumber).trim() : null,
                    secondary_beam_number: l.secondaryBeamNumber ? String(l.secondaryBeamNumber).trim() : null,
                    pissing_date: pissDate,
                    pissing_person: l.pissingPerson || null,
                    day_worker: l.dayWorker || null,
                    day_shift_hours: parseFloat(l.dayShiftHours) || 0,
                    day_meters: parseFloat(l.dayMeters) || 0,
                    night_worker: l.nightWorker || null,
                    night_shift_hours: parseFloat(l.nightShiftHours) || 0,
                    night_meters: parseFloat(l.nightMeters) || 0,
                    picks: parseInt(l.picks, 10) || 0,
                    product: l.product || null,
                    total_meters: parseFloat(l.totalMeters) || 0,
                    taka_serial: l.takaSerial ? String(l.takaSerial).trim() : null,
                    folding_date: foldDate,
                    taka_weight: l.takaWeight !== null && l.takaWeight !== undefined ? parseFloat(l.takaWeight) : null,
                    taka_assign_id: l.takaAssignId || null,
                    is_tp_roll: Boolean(l.isTpRoll),
                    tp_source_serials: Array.isArray(l.tpSourceSerials) ? l.tpSourceSerials : [],
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (prodRows.length > 0) {
                  for (let i = 0; i < prodRows.length; i += 300) {
                    const chunk = prodRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_weaving_production_logs?on_conflict=id`, {
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
              } catch(e) {
                console.warn('Weaving Production Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Yarn Production Logs (Covering, TFO, Doubler)
            if (key.startsWith('yarn_') && key.endsWith('_production_logs') && Array.isArray(value) && value.length > 0) {
              try {
                const division = key.replace('yarn_', '').replace('_production_logs', '');
                const yarnProdRows = value.map(yp => {
                  if (!yp || !yp.boriNo) return null;
                  const ypId = String(yp.id || `YP-${division}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const ypDate = (yp.date || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: ypId,
                    division: division,
                    date: ypDate,
                    bori_no: String(yp.boriNo).trim(),
                    product_name: String(yp.productName || '').trim(),
                    product_id: yp.productId || null,
                    lot_no: yp.lotNo ? String(yp.lotNo).trim() : null,
                    color: yp.color || null,
                    denier: parseFloat(yp.denier) || null,
                    tpm: parseInt(yp.tpm, 10) || null,
                    twist: yp.twist || null,
                    rolls: parseInt(yp.rolls, 10) || 0,
                    gross_weight: parseFloat(yp.grossWeight) || 0,
                    tare_weight: parseFloat(yp.tareWeight) || 0,
                    qty: parseFloat(yp.qty) || 0,
                    config_type: yp.configType || null,
                    ply: yp.ply ? String(yp.ply) : null,
                    yarns: Array.isArray(yp.yarns) ? yp.yarns : [],
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (yarnProdRows.length > 0) {
                  for (let i = 0; i < yarnProdRows.length; i += 300) {
                    const chunk = yarnProdRows.slice(i, i + 300);
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_production_logs?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => null);

                    // Fallback for schemas missing newer columns
                    if (res && !res.ok) {
                      const fallbackWithWeights = chunk.map(r => ({
                        id: r.id,
                        division: r.division,
                        date: r.date,
                        bori_no: r.bori_no,
                        product_name: r.product_name,
                        product_id: r.product_id,
                        lot_no: r.lot_no,
                        color: r.color,
                        denier: r.denier,
                        tpm: r.tpm,
                        twist: r.twist,
                        rolls: r.rolls,
                        gross_weight: r.gross_weight || 0,
                        tare_weight: r.tare_weight || 0,
                        qty: r.qty,
                        updated_at: r.updated_at
                      }));
                      const fallbackRes = await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_production_logs?on_conflict=id`, {
                        method: 'POST',
                        headers: {
                          'apikey': SUPABASE_ANON_KEY,
                          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                          'Content-Type': 'application/json',
                          'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify(fallbackWithWeights)
                      }).catch(() => null);

                      if (fallbackRes && !fallbackRes.ok) {
                        const minimalChunk = chunk.map(r => ({
                          id: r.id,
                          division: r.division,
                          date: r.date,
                          bori_no: r.bori_no,
                          product_name: r.product_name,
                          product_id: r.product_id,
                          lot_no: r.lot_no,
                          color: r.color,
                          denier: r.denier,
                          tpm: r.tpm,
                          twist: r.twist,
                          rolls: r.rolls,
                          qty: r.qty,
                          updated_at: r.updated_at
                        }));
                        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_production_logs?on_conflict=id`, {
                          method: 'POST',
                          headers: {
                            'apikey': SUPABASE_ANON_KEY,
                            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'resolution=merge-duplicates'
                          },
                          body: JSON.stringify(minimalChunk)
                        }).catch(() => {});
                      }
                    }
                  }
                }
              } catch(e) {
                console.warn('Yarn Production Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Yarn Sales Logs (Covering, TFO, Doubler)
            if (key.startsWith('yarn_') && key.endsWith('_sales_logs') && Array.isArray(value) && value.length > 0) {
              try {
                const division = key.replace('yarn_', '').replace('_sales_logs', '');
                const yarnSaleRows = value.map(ys => {
                  if (!ys) return null;
                  const ysId = String(ys.id || `YS-${division}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const ysDate = (ys.date || ys.saleDate || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: ysId,
                    division: division,
                    sale_date: ysDate,
                    challan_no: ys.challanNo ? String(ys.challanNo).trim() : null,
                    customer_name: String(ys.customerName || ys.customer || 'Unknown').trim(),
                    customer_address: ys.customerAddress || null,
                    seller_company_id: ys.sellerCompanyId || null,
                    seller_name: ys.sellerName || null,
                    discount_type: ys.discountType || 'percent',
                    discount_value: (ys.discountValue !== undefined && ys.discountValue !== null) ? parseFloat(ys.discountValue) : 0,
                    discount_amount: (ys.discountAmount !== undefined && ys.discountAmount !== null) ? parseFloat(ys.discountAmount) : 0,
                    taxable_amount: (ys.taxableAmount !== undefined && ys.taxableAmount !== null) ? parseFloat(ys.taxableAmount) : null,
                    gst_rate: (ys.gstRate !== undefined && ys.gstRate !== null) ? parseFloat(ys.gstRate) : null,
                    subtotal_amount: (ys.subtotalAmount !== undefined && ys.subtotalAmount !== null) ? parseFloat(ys.subtotalAmount) : null,
                    items: Array.isArray(ys.items) ? ys.items : [],
                    total_gross_weight: parseFloat(ys.totalGrossWeight || ys.grossWeight) || 0,
                    total_tare_weight: parseFloat(ys.totalTareWeight || ys.tareWeight) || 0,
                    total_qty: parseFloat(ys.totalQty || ys.saleQty || ys.qty) || 0,
                    total_amount: parseFloat(ys.totalAmount || ys.amount) || 0,
                    gst_amount: parseFloat(ys.gstAmount || ys.gst) || 0,
                    raw_data: ys,
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (yarnSaleRows.length > 0) {
                  for (let i = 0; i < yarnSaleRows.length; i += 300) {
                    const chunk = yarnSaleRows.slice(i, i + 300);
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_sales_logs?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => null);

                    // If database schema on Supabase doesn't have the new columns yet, fall back gracefully
                    if (res && !res.ok) {
                      const minimalChunk = chunk.map(r => ({
                        id: r.id,
                        division: r.division,
                        sale_date: r.sale_date,
                        challan_no: r.challan_no,
                        customer_name: r.customer_name,
                        items: r.items,
                        total_qty: r.total_qty,
                        total_amount: r.total_amount,
                        gst_amount: r.gst_amount,
                        updated_at: r.updated_at
                      }));
                      await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_sales_logs?on_conflict=id`, {
                        method: 'POST',
                        headers: {
                          'apikey': SUPABASE_ANON_KEY,
                          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                          'Content-Type': 'application/json',
                          'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify(minimalChunk)
                      }).catch(() => {});
                    }
                  }
                }
              } catch(e) {
                console.warn('Yarn Sales Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Fabric Dispatches & Outsource Pipeline
            if (key === 'takaDispatchStates' && typeof value === 'object' && value !== null) {
              try {
                const dispatchEntries = Object.entries(value);
                const dispatchRows = dispatchEntries.map(([serial, data]) => {
                  if (!serial || !data) return null;
                  const s = String(serial).trim();
                  return {
                    id: s,
                    taka_serial: s,
                    status: String(data.status || 'Warehouse').trim(),
                    current_stage: String(data.currentStage || data.stage || 'Warehouse').trim(),
                    vendor: data.vendor ? String(data.vendor).trim() : null,
                    customer: data.customer ? String(data.customer).trim() : null,
                    invoice_no: (data.invoice || data.invoiceNumber || data.invoiceNo) ? String(data.invoice || data.invoiceNumber || data.invoiceNo).trim() : null,
                    challan_no: (data.challan || data.challanNumber || data.challanNo) ? String(data.challan || data.challanNumber || data.challanNo).trim() : null,
                    dispatch_date: (data.dispatchDate || data.date) ? String(data.dispatchDate || data.date).split('T')[0] : null,
                    selling_rate: (data.rate !== undefined && data.rate !== null && data.rate !== '') ? parseFloat(data.rate) : null,
                    is_partial_piece: Boolean(data.isPartialPiece),
                    history: Array.isArray(data.history) ? data.history : [],
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (dispatchRows.length > 0) {
                  for (let i = 0; i < dispatchRows.length; i += 300) {
                    const chunk = dispatchRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_fabric_dispatches?on_conflict=taka_serial`, {
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
              } catch(e) {
                console.warn('Fabric Dispatches Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Fabric Cut Relations
            if (key === 'takaCutRelations' && typeof value === 'object' && value !== null) {
              try {
                const cutEntries = Object.entries(value);
                const cutRows = cutEntries.map(([parentSerial, cutData]) => {
                  if (!parentSerial || !cutData) return null;
                  const ps = String(parentSerial).trim();
                  const children = Array.isArray(cutData) ? cutData : (Array.isArray(cutData.children) ? cutData.children : []);
                  return {
                    id: ps,
                    parent_serial: ps,
                    children: children,
                    metadata: typeof cutData === 'object' && !Array.isArray(cutData) ? cutData : {},
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (cutRows.length > 0) {
                  for (let i = 0; i < cutRows.length; i += 300) {
                    const chunk = cutRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_fabric_cut_relations?on_conflict=id`, {
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
              } catch(e) {
                console.warn('Fabric Cut Relations Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Salary Sheet & Staff Attendance
            if ((key === 'aethertasks_db_state_v7' || key === 'staff-salary-state') && typeof value === 'object' && value !== null) {
              try {
                // 1. Sync Employees Master
                if (Array.isArray(value.employees) && value.employees.length > 0) {
                  const empRows = value.employees.map(emp => {
                    if (!emp || !emp.id) return null;
                    const salAmount = parseFloat(emp.salaryAmount !== undefined ? emp.salaryAmount : (emp.baseSalary !== undefined ? emp.baseSalary : emp.salaryRate)) || 0;
                    const rawJoinDate = emp.joinDate || emp.joiningDate || '';
                    const cleanJoinDate = rawJoinDate ? String(rawJoinDate).split('T')[0] : null;
                    const machines = Array.isArray(emp.machines) ? emp.machines : (Array.isArray(emp.assignedMachines) ? emp.assignedMachines : (emp.machine ? [emp.machine] : []));
                    const avatarCol = emp.avatarColor || emp.avatarGradient || null;
                    const empStatus = emp.status || (emp.active === false ? 'Terminated' : 'Active');
                    const isActive = empStatus !== 'Terminated';
                    const idFrontVal = emp.idFront || (emp.metadata && emp.metadata.idFront) || null;
                    const idBackVal = emp.idBack || (emp.metadata && emp.metadata.idBack) || null;

                    return {
                      id: String(emp.id).trim(),
                      name: String(emp.name || 'Unnamed Employee').trim(),
                      role: String(emp.role || 'Staff').trim(),
                      department: emp.department ? String(emp.department).trim() : null,
                      salary_style: String(emp.salaryStyle || 'Per Day Fixed').trim(),
                      salary_rate: parseFloat(emp.salaryRate) || salAmount,
                      base_salary: parseFloat(emp.baseSalary) || salAmount,
                      salary_amount: salAmount,
                      phone: emp.phone ? String(emp.phone).trim() : null,
                      email: emp.email ? String(emp.email).trim() : null,
                      joining_date: cleanJoinDate,
                      join_date: rawJoinDate ? rawJoinDate : null,
                      termination_date: emp.terminationDate ? String(emp.terminationDate).split('T')[0] : null,
                      rejoin_date: emp.rejoinDate ? String(emp.rejoinDate).split('T')[0] : null,
                      assigned_machines: machines,
                      avatar_gradient: avatarCol,
                      avatar_color: avatarCol,
                      id_front: idFrontVal,
                      id_back: idBackVal,
                      status: empStatus,
                      active: isActive,
                      metadata: {
                        ...(typeof emp.metadata === 'object' && emp.metadata !== null ? emp.metadata : {}),
                        machines: machines,
                        salaryAmount: salAmount,
                        avatarColor: avatarCol,
                        idFront: idFrontVal || '',
                        idBack: idBackVal || '',
                        joinDate: rawJoinDate,
                        terminationDate: emp.terminationDate || null,
                        rejoinDate: emp.rejoinDate || null,
                        status: empStatus
                      },
                      updated_at: nowIso
                    };
                  }).filter(Boolean);

                  if (empRows.length > 0) {
                    for (let i = 0; i < empRows.length; i += 300) {
                      const chunk = empRows.slice(i, i + 300);
                      await fetch(`${SUPABASE_URL}/rest/v1/vf_employees?on_conflict=id`, {
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

                // 2. Sync Attendance Records
                if (value.attendance && typeof value.attendance === 'object') {
                  const empList = Array.isArray(value.employees) ? value.employees : [];
                  const empMap = new Map();
                  empList.forEach(e => {
                    if (e) {
                      if (e.id) empMap.set(String(e.id).trim(), e);
                      if (e.name) empMap.set(String(e.name).trim().toLowerCase(), e);
                    }
                  });

                  const attRows = [];
                  Object.entries(value.attendance).forEach(([dateStr, empAttMap]) => {
                    if (!dateStr || typeof empAttMap !== 'object' || empAttMap === null) return;
                    const cleanDate = String(dateStr).split('T')[0];
                    Object.entries(empAttMap).forEach(([empKey, att]) => {
                      if (!empKey || !att) return;
                      const trimmedKey = String(empKey).trim();
                      const matchedEmp = empMap.get(trimmedKey) || empMap.get(trimmedKey.toLowerCase());
                      const targetEmpId = (matchedEmp && matchedEmp.id) ? String(matchedEmp.id).trim() : trimmedKey;
                      const attId = `${cleanDate}_${targetEmpId}`;

                      const attStatus = String(att.status || 'present').trim();
                      let shiftName = String(att.shift || 'Day').trim();
                      if (attStatus === 'night_shift') shiftName = 'Night';
                      else if (attStatus === 'double_shift') shiftName = 'Double';
                      else if (attStatus === 'half_day') shiftName = 'Half';
                      else if (attStatus === 'absent') shiftName = 'Absent';
                      else if (attStatus === 'leave') shiftName = 'Leave';
                      else if (attStatus === 'present') shiftName = 'Day';

                      const shiftsCount = (att.shifts !== undefined && att.shifts !== null) ? Number(att.shifts) : (attStatus === 'double_shift' ? 2 : (attStatus === 'half_day' ? 0.5 : (attStatus === 'absent' || attStatus === 'leave' ? 0 : 1)));

                      attRows.push({
                        id: attId,
                        attendance_date: cleanDate,
                        employee_id: targetEmpId,
                        status: attStatus,
                        shift: shiftName,
                        hours: parseFloat(att.hours) || 0,
                        overtime_hours: parseFloat(att.overtime || att.otHours) || 0,
                        meters: parseFloat(att.meters) || 0,
                        rate: parseFloat(att.rate) || 0,
                        total_earned: parseFloat(att.earned || att.totalEarned) || 0,
                        notes: att.remarks ? String(att.remarks).trim() : (att.notes ? String(att.notes).trim() : null),
                        metadata: {
                          ...(typeof att.metadata === 'object' && att.metadata !== null ? att.metadata : {}),
                          shifts: shiftsCount,
                          inTime: att.inTime || '',
                          outTime: att.outTime || '',
                          remarks: att.remarks || att.notes || '',
                          empName: (matchedEmp && matchedEmp.name) ? matchedEmp.name : trimmedKey,
                          updatedAt: att.updatedAt || nowIso
                        },
                        updated_at: att.updatedAt || nowIso
                      });
                    });
                  });

                  if (attRows.length > 0) {
                    for (let i = 0; i < attRows.length; i += 300) {
                      const chunk = attRows.slice(i, i + 300);
                      await fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?on_conflict=id`, {
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
                    const currentIds = attRows.map(r => `"${r.id}"`).join(',');
                    fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?id=not.in.(${currentIds})`, {
                      method: 'DELETE',
                      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                    }).catch(() => {});
                  } else {
                    fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records`, {
                      method: 'DELETE',
                      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                    }).catch(() => {});
                  }
                }

                // 3. Sync Employee Loans & Advances
                if (Array.isArray(value.loans) && value.loans.length > 0) {
                  const loanRows = value.loans.map(ln => {
                    if (!ln || !ln.empId) return null;
                    const lnId = String(ln.id || `LN-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                    return {
                      id: lnId,
                      employee_id: String(ln.empId).trim(),
                      loan_date: (ln.date || new Date().toISOString().split('T')[0]).split('T')[0],
                      amount: parseFloat(ln.amount) || 0,
                      type: String(ln.type || 'Advance').trim(),
                      reason: ln.reason ? String(ln.reason).trim() : null,
                      cleared: Boolean(ln.cleared),
                      updated_at: nowIso
                    };
                  }).filter(Boolean);

                  if (loanRows.length > 0) {
                    for (let i = 0; i < loanRows.length; i += 300) {
                      const chunk = loanRows.slice(i, i + 300);
                      await fetch(`${SUPABASE_URL}/rest/v1/vf_employee_loans?on_conflict=id`, {
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

                // 4. Sync Salary Settlements
                if (value.salaryPayments && typeof value.salaryPayments === 'object') {
                  const settlementRows = [];
                  Object.entries(value.salaryPayments).forEach(([monthYear, empPayMap]) => {
                    if (!monthYear || typeof empPayMap !== 'object' || empPayMap === null) return;
                    Object.entries(empPayMap).forEach(([empId, pay]) => {
                      if (!empId || !pay) return;
                      const setlId = `${monthYear}_${empId}`;
                      settlementRows.push({
                        id: setlId,
                        month_year: String(monthYear).trim(),
                        employee_id: String(empId).trim(),
                        paid_amount: parseFloat(pay.paidAmount || pay.paid) || 0,
                        net_payable: parseFloat(pay.netPayable || pay.payable) || 0,
                        paid_date: pay.paidDate ? String(pay.paidDate).split('T')[0] : null,
                        payment_mode: pay.paymentMode || pay.mode || null,
                        status: String(pay.status || 'Paid').trim(),
                        details: typeof pay === 'object' ? pay : {},
                        updated_at: nowIso
                      });
                    });
                  });

                  if (settlementRows.length > 0) {
                    for (let i = 0; i < settlementRows.length; i += 300) {
                      const chunk = settlementRows.slice(i, i + 300);
                      await fetch(`${SUPABASE_URL}/rest/v1/vf_salary_settlements?on_conflict=id`, {
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
              } catch(e) {
                console.warn('Salary Sheet Relational Sync notice:', e);
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
          debouncedWriteTimers[key] = setTimeout(executeDbWrite, 250);
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
    async deleteAttendanceDate(dateStr) {
      if (!dateStr || !activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
      try {
        const cleanDate = String(dateStr).split('T')[0];
        await fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?attendance_date=eq.${encodeURIComponent(cleanDate)}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        }).catch(() => {});
      } catch(e) {}
    },
    // Explicit Universal Item Deletion Tombstone Tracking
    async recordDeletion(key, itemId) {
      try {
        let targetIds = [];
        if (Array.isArray(itemId)) {
          targetIds = itemId.map(String).map(s => s.trim()).filter(Boolean);
        } else if (itemId && typeof itemId === 'object') {
          ['id', '_id', 'uuid', 'empId', 'employeeId', 'employee_id', 'name', 'employeeName', 'staffName', 'loanId', 'code', 'machineName', 'quality', 'supplier'].forEach(p => {
            if (itemId[p]) targetIds.push(String(itemId[p]).trim());
          });
          const customId = getItemIdentifier(itemId);
          if (customId) targetIds.push(String(customId).trim());
        } else if (itemId !== undefined && itemId !== null) {
          targetIds = [String(itemId).trim()].filter(Boolean);
        }

        if (targetIds.length === 0) return;

        let deletedIds = [];
        try {
          const raw = cache['vf_deleted_entity_ids'] || cache['vf_deleted_costing_ids'] || nativeLocalStorage.getItem('vf_deleted_entity_ids') || nativeLocalStorage.getItem('vf_deleted_costing_ids');
          if (raw) deletedIds = JSON.parse(raw);
        } catch (e) {}
        deletedIds = Array.isArray(deletedIds) ? deletedIds.map(String) : [];

        let tombstoneChanged = false;
        targetIds.forEach(idStr => {
          if (!deletedIds.includes(idStr)) {
            deletedIds.push(idStr);
            tombstoneChanged = true;
          }
        });

        if (tombstoneChanged) {
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

        const deletePayload = {
          type: 'item_deleted',
          senderId: CLIENT_ID,
          key: key,
          itemId: targetIds[0] || '',
          itemIds: targetIds,
          aliases: targetIds,
          timestamp: Date.now()
        };

        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({
              topic: WS_CHANNEL_TOPIC,
              event: 'broadcast',
              payload: {
                type: 'broadcast',
                event: 'item_deleted',
                payload: deletePayload
              },
              ref: 'del_' + Date.now()
            }));
          } catch(e) {}
        }

        if (syncChannel) {
          try {
            syncChannel.postMessage({
              type: 'item_deleted',
              senderId: CLIENT_ID,
              payload: deletePayload
            });
          } catch(e) {}
        }

        // Clean from all known entity keys in cache and localStorage immediately
        const entityKeys = [
          'yarn_sales_ledger_data', 'yarn_purchase_ledger_data',
          'yarn-qualities', 'yarn-fp-qualities', 'yarn-suppliers', 'manage-looms', 'manage-jacquards', 'manage-jalas', 'manage-fanis', 'machines',
          'yarn_covering_production_logs', 'yarn_tfo_production_logs', 'yarn_doubler_production_logs',
          'yarn_covering_sales_logs', 'yarn_tfo_sales_logs', 'yarn_doubler_sales_logs',
          'warp-beams', 'warp-issues', 'yarn-issues', 'yarn-rm-orders', 'warp-beam-loadings'
        ];
        if (key && !entityKeys.includes(key)) entityKeys.push(key);

        entityKeys.forEach(k => {
          if (cache[k]) {
            try {
              const parsed = JSON.parse(cache[k]);
              if (Array.isArray(parsed)) {
                const filtered = filterDeletedEntities(parsed);
                const newStr = JSON.stringify(filtered);
                if (cache[k] !== newStr) {
                  cache[k] = newStr;
                  safeLocalStorageSet(k, newStr);
                  this.set(k, filtered, true);
                  window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: k, value: newStr, isRemote: false } }));
                }
              }
            } catch(e) {}
          }
        });

        // Clean from state objects (e.g. aethertasks_db_state_v7, staff-salary-state)
        ['aethertasks_db_state_v7', 'staff-salary-state'].forEach(sKey => {
          const raw = cache[sKey] || nativeLocalStorage.getItem(sKey);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object') {
                let stateChanged = false;
                if (Array.isArray(parsed.employees)) {
                  const origLen = parsed.employees.length;
                  parsed.employees = filterDeletedEntities(parsed.employees);
                  if (parsed.employees.length !== origLen) stateChanged = true;
                }
                if (Array.isArray(parsed.machines)) {
                  const origLen = parsed.machines.length;
                  parsed.machines = filterDeletedEntities(parsed.machines);
                  if (parsed.machines.length !== origLen) stateChanged = true;
                }
                if (Array.isArray(parsed.loans)) {
                  const origLen = parsed.loans.length;
                  parsed.loans = filterDeletedEntities(parsed.loans);
                  if (parsed.loans.length !== origLen) stateChanged = true;
                }
                if (stateChanged) {
                  const newStr = JSON.stringify(parsed);
                  cache[sKey] = newStr;
                  safeLocalStorageSet(sKey, newStr);
                  this.set(sKey, parsed, true);
                  window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: sKey, value: newStr, isRemote: false } }));
                }
              }
            } catch(e) {}
          }
        });

        try {
          window.dispatchEvent(new CustomEvent('supabase-item-deleted', { detail: deletePayload }));
          window.dispatchEvent(new Event('storage'));
        } catch(e) {}

        // Dispatch REST DELETE to all relevant Supabase tables
        if (activeConfig.isConfigured && SUPABASE_URL) {
          const restHeaders = {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          };

          targetIds.forEach(idStr => {
            const encId = encodeURIComponent(idStr);

            // Costing tables
            if (key === 'costing-products-v4') fetch(`${SUPABASE_URL}/rest/v1/vf_costing_products?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            else if (key === 'costing-tfo-products-v1') fetch(`${SUPABASE_URL}/rest/v1/vf_costing_tfo_products?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            else if (key === 'costing-doubler-products-v1') fetch(`${SUPABASE_URL}/rest/v1/vf_costing_doubler_products?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            else if (key === 'costing-covering-products-v1') fetch(`${SUPABASE_URL}/rest/v1/vf_costing_covering_products?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            
            // Qualities & Suppliers
            else if (key === 'yarn-qualities') {
              fetch(`${SUPABASE_URL}/rest/v1/vf_rm_qualities?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
              fetch(`${SUPABASE_URL}/rest/v1/vf_rm_qualities?quality=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            }
            else if (key === 'yarn-fp-qualities') {
              fetch(`${SUPABASE_URL}/rest/v1/vf_fp_qualities?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
              fetch(`${SUPABASE_URL}/rest/v1/vf_fp_qualities?name=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            }
            else if (key === 'yarn-suppliers') {
              fetch(`${SUPABASE_URL}/rest/v1/vf_rm_suppliers?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
              fetch(`${SUPABASE_URL}/rest/v1/vf_rm_suppliers?name=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            }
            
            // Yarn Production & Sales Logs
            else if (key && key.startsWith('yarn_') && key.endsWith('_production_logs')) {
              fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_production_logs?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            }
            else if (key && key.startsWith('yarn_') && key.endsWith('_sales_logs')) {
              fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_sales_logs?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            }

            // Beam Loadings
            else if (key === 'warp-beam-loadings') {
              fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beam_loadings?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            }

            // Staff & Salary (vf_employees, vf_employee_loans, vf_attendance_records)
            if (key === 'aethertasks_db_state_v7' || key === 'manage-staff' || key === 'employees' || key === 'staff-salary-state') {
              fetch(`${SUPABASE_URL}/rest/v1/vf_employees?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
              fetch(`${SUPABASE_URL}/rest/v1/vf_employees?name=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
              fetch(`${SUPABASE_URL}/rest/v1/vf_employee_loans?id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
              fetch(`${SUPABASE_URL}/rest/v1/vf_employee_loans?employee_id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
              fetch(`${SUPABASE_URL}/rest/v1/vf_employee_loans?employee_name=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
              fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?employee_id=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
              fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?employee_name=eq.${encId}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
            }
          });
        }
      } catch (e) {}
    },
    async recordCostingDeletion(key, itemId) {
      return this.recordDeletion(key, itemId);
    },
    // Explicit Universal Item Undeletion / Restore Tracking (for Ctrl+Z Undo and New Item Creation)
    async unrecordDeletion(key, itemId, itemData = null) {
      try {
        let targetIds = [];
        if (Array.isArray(itemId)) {
          targetIds = itemId.map(String).map(s => s.trim()).filter(Boolean);
        } else if (itemId && typeof itemId === 'object') {
          ['id', '_id', 'uuid', 'syncKey'].forEach(p => {
            if (itemId[p]) targetIds.push(String(itemId[p]).trim());
          });
        } else if (itemId !== undefined && itemId !== null) {
          targetIds = [String(itemId).trim()].filter(Boolean);
        }

        if (targetIds.length === 0) return;

        const tombstoneKeys = ['vf_deleted_entity_ids', 'vf_deleted_costing_ids', 'yarn_ledger_deleted_keys', 'vf_deleted_yarn_orders'];
        tombstoneKeys.forEach(tKey => {
          let deletedIds = [];
          try {
            const raw = cache[tKey] || nativeLocalStorage.getItem(tKey);
            if (raw) deletedIds = typeof raw === 'string' ? JSON.parse(raw) : raw;
          } catch (e) {}
          if (Array.isArray(deletedIds)) {
            const beforeLen = deletedIds.length;
            deletedIds = deletedIds.filter(id => !targetIds.includes(String(id).trim()));
            if (deletedIds.length !== beforeLen) {
              const valStr = JSON.stringify(deletedIds);
              cache[tKey] = valStr;
              safeLocalStorageSet(tKey, valStr);
              this.set(tKey, deletedIds, true);
            }
          }
        });

        // Immediate re-insertion to dedicated Supabase table if itemData exists
        let table = null;
        if (key === 'costing-products-v4') table = 'vf_costing_products';
        else if (key === 'costing-tfo-products-v1') table = 'vf_costing_tfo_products';
        else if (key === 'costing-doubler-products-v1') table = 'vf_costing_doubler_products';
        else if (key === 'costing-covering-products-v1') table = 'vf_costing_covering_products';

        if (table && activeConfig.isConfigured && SUPABASE_URL && itemData) {
          const firstId = targetIds[0] || String(itemId);
          fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify([{
              id: firstId,
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
    filterDeletedEntities: filterDeletedEntities,
    getDeletedTombstones: getDeletedTombstones,
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
    // Dedicated Atomic Yarn Box Issuance RPC
    async issueYarnBoxesAtomic(boxUids, params = {}) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return { error: 'Not configured' };
      try {
        const boxIds = Array.isArray(boxUids) ? boxUids : [boxUids];
        const userInfo = getLocalUserInfo();
        const payload = {
          p_box_ids: boxIds,
          p_issued_to: params.issuedTo || params.issueTo || 'Department',
          p_issue_date: (params.issueDate || new Date().toISOString().split('T')[0]).split('T')[0],
          p_user: userInfo.email || userInfo.name || 'Operator',
          p_remarks: params.remarks || `Issued to ${params.issuedTo || 'Department'}`
        };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_issue_yarn_boxes`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const data = await res.json();
          return { data, error: null };
        } else {
          const err = await res.json().catch(() => ({}));
          return { data: null, error: err };
        }
      } catch (e) {
        return { data: null, error: e };
      }
    },
    // Dedicated Atomic Yarn Box Un-issuance (Revert to Available)
    async unissueYarnBoxesAtomic(boxUids, params = {}) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return { error: 'Not configured' };
      try {
        const boxIds = Array.isArray(boxUids) ? boxUids : [boxUids];
        const userInfo = getLocalUserInfo();

        // 1. Direct PATCH to vf_yarn_rm_boxes
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_boxes?id=in.(${boxIds.map(encodeURIComponent).join(',')})`, {
          method: 'PATCH',
          headers: this.getAuthHeaders({ 'Prefer': 'return=minimal' }),
          body: JSON.stringify({
            status: 'available',
            issue_date: null,
            issued_to: null,
            updated_at: new Date().toISOString()
          })
        });

        // 2. Clean up any issue transactions in vf_yarn_rm_transactions
        fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_transactions?box_id=in.(${boxIds.map(encodeURIComponent).join(',')})&transaction_type=eq.issue`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        }).catch(() => {});

        return { success: true, error: null };
      } catch (e) {
        return { success: false, error: e };
      }
    },
    // Dedicated Relational Lot Deletion
    async deleteYarnLotRelational(lotId) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY || !lotId) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_lots?id=eq.${encodeURIComponent(String(lotId))}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
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
      let updatedKeys = [];
      let hasChanges = false;
      try {
        if (isInitial || Object.keys(lastKnownTimestamps).length === 0) {
          const rows = await fetchAllRowsPaginated('vf_kv_store', 'key,value,updated_at');
          if (Array.isArray(rows)) {
            const kvMap = {};

            // PRIORITY STEP 1: Pre-populate and cache all deleted entity tombstones FIRST
            const tombstoneKeys = ['vf_deleted_entity_ids', 'vf_deleted_costing_ids', 'yarn_ledger_deleted_keys', 'vf_deleted_yarn_orders'];
            tombstoneKeys.forEach(tKey => {
              const tRow = rows.find(r => r && r.key === tKey);
              if (tRow && tRow.value) {
                try {
                  const remoteTombstones = typeof tRow.value === 'string' ? JSON.parse(tRow.value) : tRow.value;
                  if (Array.isArray(remoteTombstones)) {
                    let localTombstones = getDeletedTombstones();
                    const combined = Array.from(new Set([...localTombstones, ...remoteTombstones.map(String)]));
                    const valStr = JSON.stringify(combined);
                    cache[tKey] = valStr;
                    safeLocalStorageSet(tKey, valStr);
                    if (tRow.updated_at) lastKnownTimestamps[tKey] = tRow.updated_at;
                  }
                } catch(e) {}
              }
            });

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

            // Reconcile Dedicated RM Qualities Relational Table
            try {
              const qKey = 'yarn-qualities';
              const dbQualities = await fetchAllRowsPaginated('vf_rm_qualities', '*', 'order=created_at.desc');
              if (Array.isArray(dbQualities)) {
                const mappedQualities = dbQualities.map(q => ({
                  id: q.id,
                  quality: q.quality,
                  code: q.code || '',
                  color: q.color || '',
                  type: q.type || 'Polyester',
                  supplier: q.supplier || '',
                  createdAt: q.created_at || new Date().toISOString()
                }));
                const cleanDbQualities = filterDeletedEntities(mappedQualities);

                let currentKvQualities = [];
                try {
                  const rawKv = kvMap[qKey] || cache[qKey] || nativeLocalStorage.getItem(qKey);
                  if (rawKv) currentKvQualities = typeof rawKv === 'string' ? JSON.parse(rawKv) : rawKv;
                } catch(e) {}
                currentKvQualities = filterDeletedEntities(currentKvQualities);

                const finalQualities = (Array.isArray(currentKvQualities) && currentKvQualities.length > 0) ? currentKvQualities : cleanDbQualities;

                // Purge obsolete rows from database table
                const finalIdSet = new Set(finalQualities.map(q => String(q.id || '').toLowerCase()));
                const obsoleteDbRows = dbQualities.filter(q => q && q.id && !finalIdSet.has(String(q.id).toLowerCase()));
                if (obsoleteDbRows.length > 0) {
                  obsoleteDbRows.forEach(obs => {
                    const encId = encodeURIComponent(obs.id);
                    fetch(`${SUPABASE_URL}/rest/v1/vf_rm_qualities?id=eq.${encId}`, {
                      method: 'DELETE',
                      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                    }).catch(() => {});
                  });
                }

                const lastQWrite = lastLocalWrites[qKey] || 0;
                if (Date.now() - lastQWrite >= 3000) {
                  const qStr = JSON.stringify(finalQualities);
                  cache[qKey] = qStr;
                  lastSavedHashes[qKey] = computeHash(qStr);
                  safeLocalStorageSet(qKey, qStr);
                  if (!updatedKeys.includes(qKey)) updatedKeys.push(qKey);
                  hasChanges = true;
                }
              }
            } catch (qErr) {
              console.warn('RM Qualities relational reconciliation notice:', qErr);
            }

            // Reconcile Dedicated FP Qualities Relational Table
            try {
              const fpKey = 'yarn-fp-qualities';
              const dbFpQualities = await fetchAllRowsPaginated('vf_fp_qualities', '*', 'order=created_at.desc');
              if (Array.isArray(dbFpQualities)) {
                const mappedFp = dbFpQualities.map(q => ({
                  id: q.id,
                  division: q.division || 'covering',
                  name: q.name,
                  composition: q.composition || '',
                  yarns: Array.isArray(q.yarns) ? q.yarns : [],
                  denier: q.denier !== null && q.denier !== '' ? Number(q.denier) : '',
                  tpm: q.tpm !== null && q.tpm !== '' ? Number(q.tpm) : '',
                  twist: q.twist || '',
                  color: q.color || '',
                  createdAt: q.created_at || new Date().toISOString(),
                  updatedAt: q.updated_at || new Date().toISOString()
                }));
                const cleanDbFp = filterDeletedEntities(mappedFp);

                let currentKvFp = [];
                try {
                  const rawKv = kvMap[fpKey] || cache[fpKey] || nativeLocalStorage.getItem(fpKey);
                  if (rawKv) currentKvFp = typeof rawKv === 'string' ? JSON.parse(rawKv) : rawKv;
                } catch(e) {}
                currentKvFp = filterDeletedEntities(currentKvFp);

                const finalFp = (Array.isArray(currentKvFp) && currentKvFp.length > 0) ? currentKvFp : cleanDbFp;

                // Purge obsolete rows from database table
                const finalFpIdSet = new Set(finalFp.map(q => String(q.id || '').toLowerCase()));
                const obsoleteFpRows = dbFpQualities.filter(q => q && q.id && !finalFpIdSet.has(String(q.id).toLowerCase()));
                if (obsoleteFpRows.length > 0) {
                  obsoleteFpRows.forEach(obs => {
                    const encId = encodeURIComponent(obs.id);
                    fetch(`${SUPABASE_URL}/rest/v1/vf_fp_qualities?id=eq.${encId}`, {
                      method: 'DELETE',
                      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                    }).catch(() => {});
                  });
                }

                const lastFpWrite = lastLocalWrites[fpKey] || 0;
                if (Date.now() - lastFpWrite >= 3000) {
                  const fpStr = JSON.stringify(finalFp);
                  cache[fpKey] = fpStr;
                  lastSavedHashes[fpKey] = computeHash(fpStr);
                  safeLocalStorageSet(fpKey, fpStr);
                  if (!updatedKeys.includes(fpKey)) updatedKeys.push(fpKey);
                  hasChanges = true;
                }
              }
            } catch (fpErr) {
              console.warn('FP Qualities relational reconciliation notice:', fpErr);
            }

            // Reconcile Dedicated RM Suppliers Relational Table
            try {
              const sKey = 'yarn-suppliers';
              const dbSuppliers = await fetchAllRowsPaginated('vf_rm_suppliers', '*', 'order=created_at.desc');
              if (Array.isArray(dbSuppliers)) {
                const mappedSuppliers = dbSuppliers.map(s => ({
                  id: s.id,
                  name: s.name,
                  phone: s.phone || '',
                  email: s.email || '',
                  address: s.address || '',
                  notes: s.notes || '',
                  createdAt: s.created_at || new Date().toISOString()
                }));
                const cleanDbSuppliers = filterDeletedEntities(mappedSuppliers);

                let currentKvSuppliers = [];
                try {
                  const rawKv = kvMap[sKey] || cache[sKey] || nativeLocalStorage.getItem(sKey);
                  if (rawKv) currentKvSuppliers = typeof rawKv === 'string' ? JSON.parse(rawKv) : rawKv;
                } catch(e) {}
                currentKvSuppliers = filterDeletedEntities(currentKvSuppliers);

                const finalSuppliers = (Array.isArray(currentKvSuppliers) && currentKvSuppliers.length > 0) ? currentKvSuppliers : cleanDbSuppliers;

                // Purge obsolete rows from database table
                const finalSuppIdSet = new Set(finalSuppliers.map(s => String(s.id || '').toLowerCase()));
                const obsoleteSuppRows = dbSuppliers.filter(s => s && s.id && !finalSuppIdSet.has(String(s.id).toLowerCase()));
                if (obsoleteSuppRows.length > 0) {
                  obsoleteSuppRows.forEach(obs => {
                    const encId = encodeURIComponent(obs.id);
                    fetch(`${SUPABASE_URL}/rest/v1/vf_rm_suppliers?id=eq.${encId}`, {
                      method: 'DELETE',
                      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                    }).catch(() => {});
                  });
                }

                const lastSWrite = lastLocalWrites[sKey] || 0;
                if (Date.now() - lastSWrite >= 3000) {
                  const sStr = JSON.stringify(finalSuppliers);
                  cache[sKey] = sStr;
                  lastSavedHashes[sKey] = computeHash(sStr);
                  safeLocalStorageSet(sKey, sStr);
                  if (!updatedKeys.includes(sKey)) updatedKeys.push(sKey);
                  hasChanges = true;
                }
              }
            } catch (sErr) {
              console.warn('RM Suppliers relational reconciliation notice:', sErr);
            }

            // Reconcile Dedicated Yarn RM Relational Tables for enterprise data integrity
            try {
              const yKey = 'vishwa_yarn_rm_stock_data';
              const yarnLots = await fetchAllRowsPaginated('vf_yarn_rm_lots', '*', 'order=receive_date.desc');
              const yarnBoxes = await fetchAllRowsPaginated('vf_yarn_rm_boxes', '*', 'order=box_number.asc');

              if (Array.isArray(yarnLots) && yarnLots.length > 0) {
                const boxesByLot = new Map();
                (yarnBoxes || []).forEach(b => {
                  if (!boxesByLot.has(b.lot_id)) boxesByLot.set(b.lot_id, []);
                  const isIssued = b.status === 'issued';
                  const issueDate = isIssued ? (b.issue_date || null) : null;
                  const issuedTo = isIssued ? (b.issued_to || null) : null;

                  boxesByLot.get(b.lot_id).push({
                    id: b.box_number || b.id,
                    boxNumber: b.box_number,
                    cones: b.cones || 0,
                    grossWeight: Number(b.gross_weight) || 0,
                    remainingWeight: Number(b.remaining_weight) || 0,
                    weight: Number(b.active_weight) || 0,
                    status: b.status === 'gr' ? 'gr' : (isIssued ? 'issued' : 'available'),
                    issueDate: isIssued ? issueDate : null,
                    issuedTo: isIssued ? issuedTo : null,
                    previousIssueDate: isIssued ? issueDate : null,
                    previousIssuedTo: isIssued ? issuedTo : null,
                    updated_at: b.updated_at || null,
                    unissued_at: isIssued ? null : (b.unissued_at || null),
                    grDate: b.gr_date || null,
                    grWeight: Number(b.gr_weight) || 0,
                    grRemarks: b.gr_remarks || null
                  });
                });

                const reconstructedStock = yarnLots.map(l => ({
                  id: l.id,
                  batchId: l.batch_id || '',
                  lotNumber: l.lot_number,
                  challanNo: l.challan_number || '',
                  challanNumber: l.challan_number || '',
                  receiveDate: l.receive_date,
                  date: l.receive_date,
                  supplier: l.supplier,
                  quality: l.quality,
                  itemType: l.item_type || 'Polyester',
                  code: l.code || '',
                  color: l.color || '',
                  rate: Number(l.rate) || 0,
                  orderRef: l.order_ref || '',
                  notes: l.notes || '',
                  boxes: boxesByLot.get(l.id) || []
                }));

                let localStock = [];
                try {
                  const locRaw = cache[yKey] || nativeLocalStorage.getItem(yKey);
                  if (locRaw) localStock = JSON.parse(locRaw);
                } catch(e) {}
                const finalStock = mergeYarnStockDatasets(localStock, reconstructedStock);

                const yStr = JSON.stringify(finalStock);
                const lastYarnWrite = lastLocalWrites[yKey] || 0;
                if (Date.now() - lastYarnWrite >= 3000) {
                  cache[yKey] = yStr;
                  lastSavedHashes[yKey] = computeHash(yStr);
                  safeLocalStorageSet(yKey, yStr);
                  if (!updatedKeys.includes(yKey)) updatedKeys.push(yKey);
                  hasChanges = true;
                }
              }
            } catch (yarnErr) {
              console.warn('Yarn RM relational reconciliation notice:', yarnErr);
            }

            // Reconcile Dedicated Yarn RM Orders Relational Tables
            try {
              const oKey = 'yarn-rm-orders';
              const dbOrders = await fetchAllRowsPaginated('vf_yarn_orders', '*', 'order=order_date.desc');
              const dbBatches = await fetchAllRowsPaginated('vf_yarn_order_batches', '*', 'order=receive_date.desc');
              const dbBoxes = await fetchAllRowsPaginated('vf_yarn_order_boxes', '*', 'order=box_number.asc');

              if (Array.isArray(dbOrders) && dbOrders.length > 0) {
                const boxesByBatch = new Map();
                (dbBoxes || []).forEach(bx => {
                  if (!boxesByBatch.has(bx.batch_id)) boxesByBatch.set(bx.batch_id, []);
                  boxesByBatch.get(bx.batch_id).push({
                    boxNumber: bx.box_number,
                    weight: Number(bx.weight) || 0,
                    cones: bx.cones || 0,
                    returnedWeight: Number(bx.returned_weight) || 0,
                    returnedDate: bx.returned_date || null,
                    returnReason: bx.return_reason || null
                  });
                });

                const batchesByOrder = new Map();
                (dbBatches || []).forEach(b => {
                  if (!batchesByOrder.has(b.order_id)) batchesByOrder.set(b.order_id, []);
                  batchesByOrder.get(b.order_id).push({
                    id: b.id,
                    challanNumber: b.challan_number || '',
                    lotNumber: b.lot_number || '',
                    receiveDate: b.receive_date || '',
                    totalWeight: Number(b.total_weight) || 0,
                    notes: b.notes || '',
                    boxes: boxesByBatch.get(b.id) || []
                  });
                });

                const reconstructedOrders = dbOrders.map(o => {
                  const relBatches = batchesByOrder.get(o.id) || [];
                  let finalBatches = relBatches;
                  let finalStatus = o.status || 'Active';
                  let finalUpdatedAt = o.updated_at || o.updatedAt || null;
                  try {
                    const kvOrders = JSON.parse(kvMap[oKey] || cache[oKey] || '[]');
                    if (Array.isArray(kvOrders)) {
                      const kvOrder = kvOrders.find(x => x.id === o.id);
                      if (kvOrder && Array.isArray(kvOrder.batches)) {
                        finalBatches = finalBatches.map(fb => {
                          const kvBatch = kvOrder.batches.find(kb => kb && (kb.id === fb.id || (kb.lotNumber === fb.lotNumber && kb.challanNumber === fb.challanNumber)));
                          if (!kvBatch || !Array.isArray(kvBatch.boxes)) return fb;
                          const kvBoxMap = new Map(kvBatch.boxes.map(kbx => [String(kbx.boxNumber || kbx.id), kbx]));
                          const mergedBoxes = (fb.boxes || []).map(bx => {
                            const kvBx = kvBoxMap.get(String(bx.boxNumber || bx.id));
                            if (!kvBx) return bx;
                            return {
                              ...bx,
                              status: kvBx.status || bx.status || 'available',
                              issueDate: kvBx.issueDate || null,
                              issuedTo: kvBx.issuedTo || null,
                              previousIssueDate: kvBx.previousIssueDate || null,
                              previousIssuedTo: kvBx.previousIssuedTo || null,
                              unissued_at: kvBx.unissued_at || null,
                              updated_at: kvBx.updated_at || bx.updated_at || null
                            };
                          });
                          return {
                            ...fb,
                            boxes: mergedBoxes,
                            updated_at: kvBatch.updated_at || fb.updated_at
                          };
                        });
                        if (kvOrder.batches.length > finalBatches.length) {
                          finalBatches = kvOrder.batches;
                        }
                        const kvTime = (kvOrder.updated_at || kvOrder.updatedAt) ? new Date(kvOrder.updated_at || kvOrder.updatedAt).getTime() : 0;
                        const dbTime = finalUpdatedAt ? new Date(finalUpdatedAt).getTime() : 0;
                        if (kvTime > dbTime && kvOrder.status) {
                          finalStatus = kvOrder.status;
                          finalUpdatedAt = kvOrder.updated_at || kvOrder.updatedAt;
                        }
                      }
                    }
                  } catch(e) {}

                  return {
                    id: o.id,
                    orderNumber: o.order_number,
                    orderDate: o.order_date,
                    supplier: o.supplier,
                    category: o.category || 'Polyester',
                    type: o.category || 'Polyester',
                    quality: o.quality,
                    code: o.code || '',
                    color: o.color || '',
                    orderedWeight: Number(o.ordered_weight) || 0,
                    price: Number(o.price) || 0,
                    status: finalStatus,
                    remarks: o.remarks || '',
                    batches: finalBatches,
                    updated_at: finalUpdatedAt,
                    updatedAt: finalUpdatedAt
                  };
                });

                let localOrders = [];
                try {
                  const locOrdRaw = cache[oKey] || nativeLocalStorage.getItem(oKey);
                  if (locOrdRaw) localOrders = JSON.parse(locOrdRaw);
                } catch(e) {}
                const finalOrders = mergeYarnOrdersDatasets(localOrders, reconstructedOrders);

                const oStr = JSON.stringify(finalOrders);
                const lastOrderWrite = lastLocalWrites[oKey] || 0;
                if (Date.now() - lastOrderWrite >= 3000) {
                  cache[oKey] = oStr;
                  lastSavedHashes[oKey] = computeHash(oStr);
                  safeLocalStorageSet(oKey, oStr);
                  if (!updatedKeys.includes(oKey)) updatedKeys.push(oKey);
                  hasChanges = true;
                }
              }
            } catch (orderErr) {
              console.warn('Yarn RM Orders relational reconciliation notice:', orderErr);
            }

            // Reconcile Dedicated Weft Issues Relational Table
            try {
              const dbIssues = await fetchAllRowsPaginated('vf_weft_issues', '*', 'order=date.desc');
              if (Array.isArray(dbIssues) && dbIssues.length > 0) {
                const reconstructedIssues = dbIssues.map(iss => ({
                  id: iss.id,
                  date: iss.date,
                  quality: iss.quality,
                  supplier: iss.supplier,
                  code: iss.code || '',
                  color: iss.color || '',
                  box: iss.box,
                  challan: iss.challan || '',
                  lot: iss.lot || '',
                  cones: Number(iss.cones) || 0,
                  net: Number(iss.net) || 0,
                  details: iss.details || ''
                }));

                const issKey = 'yarn-issues';
                const issStr = JSON.stringify(reconstructedIssues);
                const lastIssWrite = lastLocalWrites[issKey] || 0;
                if (Date.now() - lastIssWrite >= 3000) {
                  cache[issKey] = issStr;
                  lastSavedHashes[issKey] = computeHash(issStr);
                  safeLocalStorageSet(issKey, issStr);
                  if (!updatedKeys.includes(issKey)) updatedKeys.push(issKey);
                  hasChanges = true;
                }
              }
            } catch (issErr) {
              console.warn('Weft Issues relational reconciliation notice:', issErr);
            }

            // Reconcile Dedicated Warp Beams Relational Table
            try {
              const dbBeams = await fetchAllRowsPaginated('vf_warp_beams', '*', 'order=created_at.desc');
              if (Array.isArray(dbBeams) && dbBeams.length > 0) {
                const reconstructedBeams = dbBeams.map(b => ({
                  id: b.id,
                  beamNumber: b.beam_number,
                  quality: b.quality,
                  code: b.code || '',
                  color: b.color || '',
                  meters: Number(b.meters) || 0,
                  ends: b.ends || 0,
                  status: b.status || 'Available',
                  machineNumber: b.machine_number || null,
                  warpingPerson: b.warping_person || '',
                  createdAt: b.created_at,
                  history: Array.isArray(b.history) ? b.history : []
                }));

                const bKey = 'warp-beams';
                const bStr = JSON.stringify(reconstructedBeams);
                const lastBWrite = lastLocalWrites[bKey] || 0;
                if (Date.now() - lastBWrite >= 3000) {
                  cache[bKey] = bStr;
                  lastSavedHashes[bKey] = computeHash(bStr);
                  safeLocalStorageSet(bKey, bStr);
                  if (!updatedKeys.includes(bKey)) updatedKeys.push(bKey);
                  hasChanges = true;
                }
              }
            } catch (bErr) {
              console.warn('Warp Beams relational reconciliation notice:', bErr);
            }

            // Reconcile Dedicated Warp Issues Relational Table
            try {
              const dbWarpIssues = await fetchAllRowsPaginated('vf_warp_issues', '*', 'order=date.desc');
              if (Array.isArray(dbWarpIssues) && dbWarpIssues.length > 0) {
                const reconstructedWarpIssues = dbWarpIssues.map(iss => ({
                  id: iss.id,
                  date: iss.date,
                  quality: iss.quality,
                  code: iss.code || '',
                  color: iss.color || '',
                  issuedWeight: Number(iss.issued_weight) || 0,
                  details: iss.details || '',
                  supplier: iss.supplier || ''
                }));

                const wiKey = 'warp-issues';
                const wiStr = JSON.stringify(reconstructedWarpIssues);
                const lastWiWrite = lastLocalWrites[wiKey] || 0;
                if (Date.now() - lastWiWrite >= 3000) {
                  cache[wiKey] = wiStr;
                  lastSavedHashes[wiKey] = computeHash(wiStr);
                  safeLocalStorageSet(wiKey, wiStr);
                  if (!updatedKeys.includes(wiKey)) updatedKeys.push(wiKey);
                  hasChanges = true;
                }
              }
            } catch (wiErr) {
              console.warn('Warp Issues relational reconciliation notice:', wiErr);
            }

            // Reconcile Dedicated Warp Beam Loadings Relational Table
            try {
              const dbLoadings = await fetchAllRowsPaginated('vf_warp_beam_loadings', '*', 'order=date.desc');
              if (Array.isArray(dbLoadings) && dbLoadings.length > 0) {
                const reconstructedLoadings = dbLoadings.map(bl => ({
                  id: bl.id,
                  date: bl.date,
                  piecein: bl.piecein || '',
                  drawingIn: bl.drawing_in || '',
                  fani: bl.fani || '',
                  dropPinJog: bl.drop_pin_jog || '',
                  machineNumber: bl.machine_number || '',
                  beamNumber: bl.beam_number || '',
                  itemColor: bl.item_color || '',
                  meters: Number(bl.meters) || 0,
                  ends: bl.ends || 0,
                  rate: Number(bl.rate) || 0,
                  paymentAmount: Number(bl.payment_amount) || 0
                }));

                const blKey = 'warp-beam-loadings';
                const blStr = JSON.stringify(reconstructedLoadings);
                const lastBlWrite = lastLocalWrites[blKey] || 0;
                if (Date.now() - lastBlWrite >= 3000) {
                  cache[blKey] = blStr;
                  lastSavedHashes[blKey] = computeHash(blStr);
                  safeLocalStorageSet(blKey, blStr);
                  if (!updatedKeys.includes(blKey)) updatedKeys.push(blKey);
                  hasChanges = true;
                }
              }
            } catch (blErr) {
              console.warn('Warp Beam Loadings relational reconciliation notice:', blErr);
            }

            // Reconcile Dedicated Weaving Production Logs Relational Table
            try {
              const dbWeavLogs = await fetchAllRowsPaginated('vf_weaving_production_logs', '*', 'order=production_date.desc');
              if (Array.isArray(dbWeavLogs) && dbWeavLogs.length > 0) {
                const reconstructedWeavLogs = dbWeavLogs.map(l => ({
                  id: isNaN(Number(l.id)) ? l.id : Number(l.id),
                  productionDate: l.production_date,
                  machineNumber: l.machine_number,
                  beamNumber: l.beam_number || '',
                  secondaryBeamNumber: l.secondary_beam_number || '',
                  pissingDate: l.pissing_date || '',
                  pissingPerson: l.pissing_person || '',
                  dayWorker: l.day_worker || '',
                  dayShiftHours: Number(l.day_shift_hours) || 0,
                  dayMeters: Number(l.day_meters) || 0,
                  nightWorker: l.night_worker || '',
                  nightShiftHours: Number(l.night_shift_hours) || 0,
                  nightMeters: Number(l.night_meters) || 0,
                  picks: Number(l.picks) || 0,
                  product: l.product || '',
                  totalMeters: Number(l.total_meters) || 0,
                  takaSerial: l.taka_serial || null,
                  foldingDate: l.folding_date || null,
                  takaWeight: l.taka_weight !== null ? Number(l.taka_weight) : null,
                  takaAssignId: l.taka_assign_id || null,
                  isTpRoll: Boolean(l.is_tp_roll),
                  tpSourceSerials: Array.isArray(l.tp_source_serials) ? l.tp_source_serials : []
                }));

                const weavKey = 'productionLogs';
                const weavStr = JSON.stringify(reconstructedWeavLogs);
                const lastWeavWrite = lastLocalWrites[weavKey] || 0;
                if (Date.now() - lastWeavWrite >= 3000) {
                  cache[weavKey] = weavStr;
                  lastSavedHashes[weavKey] = computeHash(weavStr);
                  safeLocalStorageSet(weavKey, weavStr);
                  if (!updatedKeys.includes(weavKey)) updatedKeys.push(weavKey);
                  hasChanges = true;
                }
              }
            } catch (weavErr) {
              console.warn('Weaving Production relational reconciliation notice:', weavErr);
            }

            // Reconcile Dedicated Yarn Production Logs Relational Table
            try {
              const dbYarnProd = await fetchAllRowsPaginated('vf_yarn_production_logs', '*', 'order=date.desc');
              if (Array.isArray(dbYarnProd)) {
                const tombstones = getDeletedTombstones();
                const tombstoneSet = new Set(tombstones);
                const divisions = ['covering', 'tfo', 'doubler'];
                divisions.forEach(div => {
                  const ypKey = `yarn_${div}_production_logs`;
                  // Strictly filter out any deleted/tombstoned entities
                  const divRows = dbYarnProd.filter(r => (r.division || '').toLowerCase() === div && !tombstoneSet.has(String(r.id)));

                  // Background permanent purge of tombstoned records still on DB
                  const tombstonedInDb = dbYarnProd.filter(r => (r.division || '').toLowerCase() === div && tombstoneSet.has(String(r.id)));
                  if (tombstonedInDb.length > 0 && activeConfig.isConfigured && SUPABASE_URL) {
                    tombstonedInDb.forEach(tRow => {
                      fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_production_logs?id=eq.${encodeURIComponent(tRow.id)}`, {
                        method: 'DELETE',
                        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                      }).catch(() => {});
                    });
                  }

                  const reconstructed = divRows.map(yp => ({
                    id: yp.id,
                    date: yp.date,
                    boriNo: yp.bori_no,
                    productName: yp.product_name,
                    productId: yp.product_id || '',
                    lotNo: yp.lot_no || '',
                    color: yp.color || '',
                    denier: yp.denier !== null ? Number(yp.denier) : '',
                    tpm: yp.tpm !== null ? Number(yp.tpm) : '',
                    twist: yp.twist || '',
                    rolls: Number(yp.rolls) || 0,
                    grossWeight: yp.gross_weight !== null && yp.gross_weight !== undefined ? Number(yp.gross_weight) : 0,
                    tareWeight: yp.tare_weight !== null && yp.tare_weight !== undefined ? Number(yp.tare_weight) : 0,
                    qty: Number(yp.qty) || 0,
                    configType: yp.config_type || '',
                    ply: yp.ply || '',
                    yarns: Array.isArray(yp.yarns) ? yp.yarns : []
                  }));

                  let localItems = [];
                  try {
                    const localRaw = cache[ypKey] || nativeLocalStorage.getItem(ypKey);
                    if (localRaw) localItems = JSON.parse(localRaw);
                  } catch(e) {}

                  const mergedProd = mergeYarnProductionDatasets(localItems, reconstructed, div);
                  const ypStr = JSON.stringify(mergedProd);
                  const lastYpWrite = lastLocalWrites[ypKey] || 0;
                  if (Date.now() - lastYpWrite >= 3000) {
                    cache[ypKey] = ypStr;
                    lastSavedHashes[ypKey] = computeHash(ypStr);
                    safeLocalStorageSet(ypKey, ypStr);
                    if (!updatedKeys.includes(ypKey)) updatedKeys.push(ypKey);
                    hasChanges = true;
                  }

                  // Auto-backfill: If local items had production logs not on the server, persist to Supabase immediately
                  const missingProdOnServer = mergedProd.filter(mp => mp && mp.id && !divRows.some(dr => String(dr.id) === String(mp.id)));
                  if (missingProdOnServer.length > 0 && activeConfig.isConfigured && SUPABASE_URL) {
                    supabaseApi.set(ypKey, mergedProd, true);
                  }
                });
              }
            } catch (ypErr) {
              console.warn('Yarn Production relational reconciliation notice:', ypErr);
            }

            // Reconcile Dedicated Yarn Sales Logs Relational Table
            try {
              const dbYarnSales = await fetchAllRowsPaginated('vf_yarn_sales_logs', '*', 'order=sale_date.desc');
              if (Array.isArray(dbYarnSales)) {
                const tombstones = getDeletedTombstones();
                const tombstoneSet = new Set(tombstones);
                const divisions = ['covering', 'tfo', 'doubler'];
                divisions.forEach(div => {
                  const ysKey = `yarn_${div}_sales_logs`;
                  // Strictly filter out any deleted/tombstoned entities
                  const divRows = dbYarnSales.filter(r => (r.division || '').toLowerCase() === div && !tombstoneSet.has(String(r.id)));

                  // Background permanent purge of tombstoned records still on DB
                  const tombstonedInDb = dbYarnSales.filter(r => (r.division || '').toLowerCase() === div && tombstoneSet.has(String(r.id)));
                  if (tombstonedInDb.length > 0 && activeConfig.isConfigured && SUPABASE_URL) {
                    tombstonedInDb.forEach(tRow => {
                      fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_sales_logs?id=eq.${encodeURIComponent(tRow.id)}`, {
                        method: 'DELETE',
                        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
                      }).catch(() => {});
                    });
                  }

                  const reconstructed = divRows.map(ys => {
                    const raw = (ys.raw_data && typeof ys.raw_data === 'object') ? ys.raw_data : {};
                    const totalGross = (ys.total_gross_weight !== null && ys.total_gross_weight !== undefined) ? Number(ys.total_gross_weight) : ((raw.totalGrossWeight !== undefined && raw.totalGrossWeight !== null) ? Number(raw.totalGrossWeight) : (Number(raw.grossWeight) || 0));
                    const totalTare = (ys.total_tare_weight !== null && ys.total_tare_weight !== undefined) ? Number(ys.total_tare_weight) : ((raw.totalTareWeight !== undefined && raw.totalTareWeight !== null) ? Number(raw.totalTareWeight) : (Number(raw.tareWeight) || 0));
                    return {
                      ...raw,
                      id: ys.id,
                      saleDate: ys.sale_date,
                      date: ys.sale_date,
                      challanNo: ys.challan_no || raw.challanNo || '',
                      customerName: ys.customer_name || raw.customerName || '',
                      customer: ys.customer_name || raw.customerName || '',
                      customerAddress: ys.customer_address || raw.customerAddress || 'Industrial Area, Surat, Gujarat, India',
                      sellerCompanyId: ys.seller_company_id || raw.sellerCompanyId || '',
                      sellerName: ys.seller_name || raw.sellerName || 'Vishwa Fashions',
                      discountType: ys.discount_type || raw.discountType || 'percent',
                      discountValue: (ys.discount_value !== undefined && ys.discount_value !== null) ? Number(ys.discount_value) : ((raw.discountValue !== undefined && raw.discountValue !== null) ? Number(raw.discountValue) : 0),
                      discountAmount: (ys.discount_amount !== undefined && ys.discount_amount !== null) ? Number(ys.discount_amount) : ((raw.discountAmount !== undefined && raw.discountAmount !== null) ? Number(raw.discountAmount) : 0),
                      taxableAmount: (ys.taxable_amount !== undefined && ys.taxable_amount !== null) ? Number(ys.taxable_amount) : (raw.taxableAmount !== undefined ? Number(raw.taxableAmount) : null),
                      gstRate: (ys.gst_rate !== undefined && ys.gst_rate !== null) ? Number(ys.gst_rate) : (raw.gstRate !== undefined ? Number(raw.gstRate) : null),
                      subtotalAmount: (ys.subtotal_amount !== undefined && ys.subtotal_amount !== null) ? Number(ys.subtotal_amount) : (raw.subtotalAmount !== undefined ? Number(raw.subtotalAmount) : null),
                      items: Array.isArray(ys.items) && ys.items.length > 0 ? ys.items : (Array.isArray(raw.items) ? raw.items : []),
                      totalGrossWeight: totalGross,
                      totalTareWeight: totalTare,
                      grossWeight: totalGross,
                      tareWeight: totalTare,
                      totalQty: Number(ys.total_qty || raw.totalQty || raw.saleQty) || 0,
                      saleQty: Number(ys.total_qty || raw.totalQty || raw.saleQty) || 0,
                      qty: Number(ys.total_qty || raw.totalQty || raw.saleQty) || 0,
                      totalAmount: Number(ys.total_amount || raw.totalAmount || raw.amount) || 0,
                      amount: Number(ys.total_amount || raw.totalAmount || raw.amount) || 0,
                      gstAmount: Number(ys.gst_amount || raw.gstAmount || raw.gst) || 0,
                      gst: Number(ys.gst_amount || raw.gstAmount || raw.gst) || 0
                    };
                  });

                  let localItems = [];
                  try {
                    const localRaw = cache[ysKey] || nativeLocalStorage.getItem(ysKey);
                    if (localRaw) localItems = JSON.parse(localRaw);
                  } catch(e) {}

                  const mergedSales = mergeYarnSalesDatasets(localItems, reconstructed, div);
                  const ysStr = JSON.stringify(mergedSales);
                  const lastYsWrite = lastLocalWrites[ysKey] || 0;
                  if (Date.now() - lastYsWrite >= 3000) {
                    cache[ysKey] = ysStr;
                    lastSavedHashes[ysKey] = computeHash(ysStr);
                    safeLocalStorageSet(ysKey, ysStr);
                    if (!updatedKeys.includes(ysKey)) updatedKeys.push(ysKey);
                    hasChanges = true;
                  }

                  // Auto-backfill: If local items had sales not on the server, persist to Supabase immediately
                  const missingSalesOnServer = mergedSales.filter(ms => ms && ms.id && !divRows.some(dr => String(dr.id) === String(ms.id)));
                  if (missingSalesOnServer.length > 0 && activeConfig.isConfigured && SUPABASE_URL) {
                    supabaseApi.set(ysKey, mergedSales, true);
                  }
                });
              }
            } catch (ysErr) {
              console.warn('Yarn Sales relational reconciliation notice:', ysErr);
            }

            // Reconcile Dedicated Fabric Dispatches Relational Table
            try {
              const dbDispatches = await fetchAllRowsPaginated('vf_fabric_dispatches', '*', 'order=created_at.desc');
              if (Array.isArray(dbDispatches) && dbDispatches.length > 0) {
                const reconstructedStates = {};
                dbDispatches.forEach(d => {
                  if (!d.taka_serial) return;
                  reconstructedStates[d.taka_serial] = {
                    status: d.status || 'Warehouse',
                    currentStage: d.current_stage || 'Warehouse',
                    vendor: d.vendor || '',
                    customer: d.customer || '',
                    invoice: d.invoice_no || '',
                    challan: d.challan_no || '',
                    dispatchDate: d.dispatch_date || '',
                    rate: d.selling_rate !== null ? Number(d.selling_rate) : '',
                    isPartialPiece: Boolean(d.is_partial_piece),
                    history: Array.isArray(d.history) ? d.history : []
                  };
                });

                const dispKey = 'takaDispatchStates';
                const dispStr = JSON.stringify(reconstructedStates);
                const lastDispWrite = lastLocalWrites[dispKey] || 0;
                if (Date.now() - lastDispWrite >= 3000) {
                  cache[dispKey] = dispStr;
                  lastSavedHashes[dispKey] = computeHash(dispStr);
                  safeLocalStorageSet(dispKey, dispStr);
                  if (!updatedKeys.includes(dispKey)) updatedKeys.push(dispKey);
                  hasChanges = true;
                }
              }
            } catch (dispErr) {
              console.warn('Fabric Dispatches relational reconciliation notice:', dispErr);
            }

            // Reconcile Dedicated Fabric Cut Relations Relational Table
            try {
              const dbCuts = await fetchAllRowsPaginated('vf_fabric_cut_relations', '*', 'order=created_at.desc');
              if (Array.isArray(dbCuts) && dbCuts.length > 0) {
                const reconstructedCuts = {};
                dbCuts.forEach(c => {
                  if (!c.parent_serial) return;
                  if (c.metadata && typeof c.metadata === 'object' && Object.keys(c.metadata).length > 0) {
                    reconstructedCuts[c.parent_serial] = c.metadata;
                  } else {
                    reconstructedCuts[c.parent_serial] = Array.isArray(c.children) ? c.children : [];
                  }
                });

                const cutKey = 'takaCutRelations';
                const cutStr = JSON.stringify(reconstructedCuts);
                const lastCutWrite = lastLocalWrites[cutKey] || 0;
                if (Date.now() - lastCutWrite >= 3000) {
                  cache[cutKey] = cutStr;
                  lastSavedHashes[cutKey] = computeHash(cutStr);
                  safeLocalStorageSet(cutKey, cutStr);
                  if (!updatedKeys.includes(cutKey)) updatedKeys.push(cutKey);
                  hasChanges = true;
                }
              }
            } catch (cutErr) {
              console.warn('Fabric Cut Relations relational reconciliation notice:', cutErr);
            }

            // Reconcile Dedicated Salary Sheet & Staff Attendance Tables
            try {
              const [dbEmployees, dbAttendance, dbLoans, dbSettlements] = await Promise.all([
                fetchAllRowsPaginated('vf_employees', '*', 'order=name.asc'),
                fetchAllRowsPaginated('vf_attendance_records', '*', 'order=attendance_date.desc'),
                fetchAllRowsPaginated('vf_employee_loans', '*', 'order=loan_date.desc'),
                fetchAllRowsPaginated('vf_salary_settlements', '*', 'order=month_year.desc')
              ]);

              if (Array.isArray(dbEmployees) && dbEmployees.length > 0) {
                const staffKey = 'aethertasks_db_state_v7';
                let existingStaffState = {};
                try {
                  const rawStaff = cache[staffKey] || nativeLocalStorage.getItem(staffKey);
                  if (rawStaff) existingStaffState = JSON.parse(rawStaff);
                } catch(e) {}

                const tombstones = getDeletedTombstones();
                const tombstoneSet = new Set(tombstones.map(s => String(s).trim().toLowerCase()).filter(Boolean));

                // Background permanent purge of tombstoned records still on Postgres tables
                if (activeConfig.isConfigured && SUPABASE_URL) {
                  const restHeaders = {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                  };
                  if (Array.isArray(dbEmployees)) {
                    const tombstonedEmps = dbEmployees.filter(emp => {
                      const id = String(emp.id || '').trim().toLowerCase();
                      const name = String(emp.name || '').trim().toLowerCase();
                      return (id && tombstoneSet.has(id)) || (name && tombstoneSet.has(name));
                    });
                    tombstonedEmps.forEach(tEmp => {
                      if (tEmp.id) fetch(`${SUPABASE_URL}/rest/v1/vf_employees?id=eq.${encodeURIComponent(tEmp.id)}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
                      if (tEmp.name) fetch(`${SUPABASE_URL}/rest/v1/vf_employees?name=eq.${encodeURIComponent(tEmp.name)}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
                      if (tEmp.id) fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?employee_id=eq.${encodeURIComponent(tEmp.id)}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
                      if (tEmp.name) fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?employee_name=eq.${encodeURIComponent(tEmp.name)}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
                    });
                  }
                  if (Array.isArray(dbLoans)) {
                    const tombstonedLoans = dbLoans.filter(ln => {
                      const id = String(ln.id || '').trim().toLowerCase();
                      const empId = String(ln.employee_id || '').trim().toLowerCase();
                      return (id && tombstoneSet.has(id)) || (empId && tombstoneSet.has(empId));
                    });
                    tombstonedLoans.forEach(tLn => {
                      if (tLn.id) fetch(`${SUPABASE_URL}/rest/v1/vf_employee_loans?id=eq.${encodeURIComponent(tLn.id)}`, { method: 'DELETE', headers: restHeaders }).catch(() => {});
                    });
                  }
                }

                const reconstructedEmployees = dbEmployees.map(emp => {
                  const meta = (emp.metadata && typeof emp.metadata === 'object') ? emp.metadata : {};
                  const machines = Array.isArray(emp.assigned_machines) && emp.assigned_machines.length > 0
                    ? emp.assigned_machines
                    : (Array.isArray(meta.machines) ? meta.machines : []);
                  const salAmount = Number(emp.salary_amount ?? emp.base_salary ?? emp.salary_rate ?? meta.salaryAmount ?? 0);
                  const avatar = emp.avatar_color || emp.avatar_gradient || meta.avatarColor || meta.avatarGradient || 'from-purple-500 to-indigo-500';
                  const jDate = emp.join_date || emp.joining_date || meta.joinDate || meta.joiningDate || '';
                  const empStatus = emp.status || meta.status || (emp.active !== false ? 'Active' : 'Terminated');
                  const idFrontImg = emp.id_front || meta.idFront || '';
                  const idBackImg = emp.id_back || meta.idBack || '';
                  const termDate = emp.termination_date || meta.terminationDate || null;
                  const rejDate = emp.rejoin_date || meta.rejoinDate || null;

                  return {
                    id: emp.id,
                    name: emp.name,
                    role: emp.role,
                    department: emp.department || '',
                    salaryStyle: emp.salary_style || 'Per Day Fixed',
                    salaryAmount: salAmount,
                    salaryRate: Number(emp.salary_rate) || salAmount,
                    baseSalary: Number(emp.base_salary) || salAmount,
                    phone: emp.phone || '',
                    email: emp.email || '',
                    joinDate: jDate,
                    joiningDate: jDate ? String(jDate).split('T')[0] : '',
                    machines: machines,
                    assignedMachines: machines,
                    avatarColor: avatar,
                    avatarGradient: avatar,
                    status: empStatus,
                    active: empStatus !== 'Terminated',
                    idFront: idFrontImg,
                    idBack: idBackImg,
                    terminationDate: termDate,
                    rejoinDate: rejDate,
                    ...meta
                  };
                });

                const cleanReconstructedEmployees = filterDeletedEntities(reconstructedEmployees);

                const empIdToNameMap = new Map();
                cleanReconstructedEmployees.forEach(e => {
                  if (e && e.id && e.name) {
                    empIdToNameMap.set(String(e.id).trim(), e.name);
                  }
                });

                const reconstructedAttendance = {};
                if (Array.isArray(dbAttendance)) {
                  dbAttendance.forEach(att => {
                    const date = att.attendance_date;
                    const empId = att.employee_id ? String(att.employee_id).trim() : '';
                    if (!date || !empId) return;
                    if (tombstoneSet.has(empId.toLowerCase())) return;
                    if (!reconstructedAttendance[date]) reconstructedAttendance[date] = {};

                    const meta = (att.metadata && typeof att.metadata === 'object') ? att.metadata : {};
                    const empName = meta.empName || empIdToNameMap.get(empId) || empId;
                    if (empName && tombstoneSet.has(String(empName).trim().toLowerCase())) return;
                    const statusVal = att.status || 'present';
                    const shiftsVal = (meta.shifts !== undefined && meta.shifts !== null) 
                      ? Number(meta.shifts) 
                      : (statusVal === 'double_shift' ? 2 : (statusVal === 'half_day' ? 0.5 : (statusVal === 'absent' || statusVal === 'leave' ? 0 : 1)));

                    const attRecord = {
                      status: statusVal,
                      shift: att.shift || 'Day',
                      shifts: shiftsVal,
                      hours: Number(att.hours) || 0,
                      inTime: meta.inTime || '',
                      outTime: meta.outTime || '',
                      overtime: Number(att.overtime_hours) || 0,
                      meters: Number(att.meters) || 0,
                      rate: Number(att.rate) || 0,
                      earned: Number(att.total_earned) || 0,
                      notes: att.notes || '',
                      remarks: meta.remarks || att.notes || '',
                      updatedAt: att.updated_at || meta.updatedAt || new Date().toISOString(),
                      ...meta
                    };

                    // Map by employee name (used by salary-sheet.html)
                    reconstructedAttendance[date][empName] = attRecord;
                    // Also map by employee id (used by id-based lookups)
                    if (empId !== empName) {
                      reconstructedAttendance[date][empId] = attRecord;
                    }
                  });
                }

                const reconstructedLoans = Array.isArray(dbLoans) ? dbLoans.map(ln => ({
                  id: ln.id,
                  empId: ln.employee_id,
                  date: ln.loan_date,
                  amount: Number(ln.amount) || 0,
                  type: ln.type || 'Advance',
                  reason: ln.reason || '',
                  cleared: Boolean(ln.cleared)
                })) : [];

                const cleanReconstructedLoans = filterDeletedEntities(reconstructedLoans);

                const reconstructedSettlements = {};
                if (Array.isArray(dbSettlements)) {
                  dbSettlements.forEach(st => {
                    const m = st.month_year;
                    const empId = st.employee_id;
                    if (!m || !empId) return;
                    if (tombstoneSet.has(String(empId).trim().toLowerCase())) return;
                    if (!reconstructedSettlements[m]) reconstructedSettlements[m] = {};
                    reconstructedSettlements[m][empId] = {
                      paidAmount: Number(st.paid_amount) || 0,
                      netPayable: Number(st.net_payable) || 0,
                      paidDate: st.paid_date || '',
                      paymentMode: st.payment_mode || '',
                      status: st.status || 'Paid',
                      ...(st.details && typeof st.details === 'object' ? st.details : {})
                    };
                  });
                }
                // Authoritative attendance from vf_kv_store: never resurrect deleted attendance from relational table
                const hasStaffState = existingStaffState && (Array.isArray(existingStaffState.employees) || existingStaffState.attendance !== undefined);
                const finalAttendance = (hasStaffState && existingStaffState.attendance && typeof existingStaffState.attendance === 'object')
                  ? existingStaffState.attendance
                  : reconstructedAttendance;

                const existingCleanEmps = (existingStaffState && Array.isArray(existingStaffState.employees))
                  ? filterDeletedEntities(existingStaffState.employees)
                  : [];
                const existingCleanLoans = (existingStaffState && Array.isArray(existingStaffState.loans))
                  ? filterDeletedEntities(existingStaffState.loans)
                  : [];
                const existingCleanMachines = (existingStaffState && Array.isArray(existingStaffState.machines))
                  ? filterDeletedEntities(existingStaffState.machines)
                  : (existingStaffState.machines || []);

                const mergedStaffState = {
                  ...existingStaffState,
                  employees: cleanReconstructedEmployees.length > 0 ? cleanReconstructedEmployees : existingCleanEmps,
                  machines: existingCleanMachines,
                  attendance: finalAttendance,
                  loans: cleanReconstructedLoans.length > 0 ? cleanReconstructedLoans : existingCleanLoans,
                  salaryPayments: Object.keys(reconstructedSettlements).length > 0 ? reconstructedSettlements : (existingStaffState.salaryPayments || {})
                };

                const staffStr = JSON.stringify(mergedStaffState);
                const lastStaffWrite = lastLocalWrites[staffKey] || 0;
                if (Date.now() - lastStaffWrite >= 3000) {
                  cache[staffKey] = staffStr;
                  lastSavedHashes[staffKey] = computeHash(staffStr);
                  safeLocalStorageSet(staffKey, staffStr);
                  if (!updatedKeys.includes(staffKey)) updatedKeys.push(staffKey);
                  hasChanges = true;
                }
              }
            } catch (staffErr) {
              console.warn('Salary Sheet relational reconciliation notice:', staffErr);
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
        updatedKeys = [];
        hasChanges = false;
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
            // Process tombstone keys first so mergeDatasets benefits immediately
            rows.sort((a, b) => {
              const aT = a && (a.key === 'vf_deleted_entity_ids' || a.key === 'vf_deleted_costing_ids');
              const bT = b && (b.key === 'vf_deleted_entity_ids' || b.key === 'vf_deleted_costing_ids');
              return aT ? -1 : (bT ? 1 : 0);
            });
            rows.forEach(row => {
              if (!row || !row.key || isLocalOnlyKey(row.key)) return;
              try {
                if (row.key === 'vf_deleted_entity_ids' || row.key === 'vf_deleted_costing_ids') {
                  try {
                    const remoteTombstones = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
                    if (Array.isArray(remoteTombstones)) {
                      let localTombstones = getDeletedTombstones();
                      const combined = Array.from(new Set([...localTombstones, ...remoteTombstones.map(String)]));
                      const valStr = JSON.stringify(combined);
                      cache[row.key] = valStr;
                      safeLocalStorageSet(row.key, valStr);
                    }
                  } catch(e) {}
                }
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
    // --- Enterprise Warp Beams Relational APIs ---
    async fetchWarpBeamsRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_warp_beams', '*', 'order=created_at.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(b => ({
          id: b.id,
          beamNumber: b.beam_number,
          quality: b.quality,
          code: b.code || '',
          color: b.color || '',
          meters: Number(b.meters) || 0,
          ends: b.ends || 0,
          status: b.status || 'Available',
          machineNumber: b.machine_number || null,
          warpingPerson: b.warping_person || '',
          createdAt: b.created_at,
          history: Array.isArray(b.history) ? b.history : []
        }));
      } catch(e) {
        console.error('fetchWarpBeamsRelational error:', e);
        return null;
      }
    },

    async saveWarpBeamRelational(beam) {
      if (!beam || !beam.beamNumber || !activeConfig.isConfigured || !SUPABASE_URL) return;
      const bId = String(beam.id || `BEAM-${beam.beamNumber}`);
      const bCreated = (beam.createdAt || new Date().toISOString().split('T')[0]).split('T')[0];
      const payload = {
        id: bId,
        beam_number: String(beam.beamNumber).trim(),
        quality: String(beam.quality || ''),
        code: beam.code ? String(beam.code) : null,
        color: beam.color ? String(beam.color) : null,
        meters: parseFloat(beam.meters) || 0,
        ends: parseInt(beam.ends, 10) || 0,
        status: String(beam.status || 'Available'),
        machine_number: beam.machineNumber ? String(beam.machineNumber) : null,
        warping_person: beam.warpingPerson || null,
        created_at: bCreated,
        history: Array.isArray(beam.history) ? beam.history : [],
        updated_at: new Date().toISOString()
      };
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beams?on_conflict=id`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(payload)
        });
      } catch(e) {}
    },

    async deleteWarpBeamRelational(beamId) {
      if (!beamId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beams?id=eq.${encodeURIComponent(beamId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchWarpIssuesRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_warp_issues', '*', 'order=date.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(iss => ({
          id: iss.id,
          date: iss.date,
          quality: iss.quality,
          code: iss.code || '',
          color: iss.color || '',
          issuedWeight: Number(iss.issued_weight) || 0,
          details: iss.details || '',
          supplier: iss.supplier || ''
        }));
      } catch(e) {
        console.error('fetchWarpIssuesRelational error:', e);
        return null;
      }
    },

    async deleteWarpIssueRelational(issueId) {
      if (!issueId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_issues?id=eq.${encodeURIComponent(issueId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchWarpBeamLoadingsRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_warp_beam_loadings', '*', 'order=date.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(bl => ({
          id: bl.id,
          date: bl.date,
          piecein: bl.piecein || '',
          drawingIn: bl.drawing_in || '',
          fani: bl.fani || '',
          dropPinJog: bl.drop_pin_jog || '',
          machineNumber: bl.machine_number || '',
          beamNumber: bl.beam_number || '',
          itemColor: bl.item_color || '',
          meters: Number(bl.meters) || 0,
          ends: bl.ends || 0,
          rate: Number(bl.rate) || 0,
          paymentAmount: Number(bl.payment_amount) || 0
        }));
      } catch(e) {
        console.error('fetchWarpBeamLoadingsRelational error:', e);
        return null;
      }
    },

    async deleteWarpBeamLoadingRelational(loadingId) {
      if (!loadingId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beam_loadings?id=eq.${encodeURIComponent(loadingId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Weft Issues Relational APIs ---
    async fetchWeftIssuesRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_weft_issues', '*', 'order=date.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(iss => ({
          id: iss.id,
          date: iss.date,
          quality: iss.quality,
          supplier: iss.supplier,
          code: iss.code || '',
          color: iss.color || '',
          box: iss.box,
          challan: iss.challan || '',
          lot: iss.lot || '',
          cones: Number(iss.cones) || 0,
          net: Number(iss.net) || 0,
          details: iss.details || ''
        }));
      } catch(e) {
        console.error('fetchWeftIssuesRelational error:', e);
        return null;
      }
    },

    async recordWeftIssuesAtomic(issueList) {
      if (!Array.isArray(issueList) || issueList.length === 0) return { success: false, error: 'No issues to record' };
      if (activeConfig.isConfigured && SUPABASE_URL) {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_record_weft_issues`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ p_issues: issueList })
          });
          if (res.ok) {
            return await res.json();
          }
        } catch(e) {
          console.warn('RPC vf_record_weft_issues fallback to local write:', e);
        }
      }
      return { success: true, fallback: true };
    },

    async deleteWeftIssueRelational(issueId) {
      if (!issueId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_weft_issues?id=eq.${encodeURIComponent(issueId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Weaving Production Logs Relational APIs ---
    async fetchWeavingProductionRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_weaving_production_logs', '*', 'order=production_date.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(l => ({
          id: isNaN(Number(l.id)) ? l.id : Number(l.id),
          productionDate: l.production_date,
          machineNumber: l.machine_number,
          beamNumber: l.beam_number || '',
          secondaryBeamNumber: l.secondary_beam_number || '',
          pissingDate: l.pissing_date || '',
          pissingPerson: l.pissing_person || '',
          dayWorker: l.day_worker || '',
          dayShiftHours: Number(l.day_shift_hours) || 0,
          dayMeters: Number(l.day_meters) || 0,
          nightWorker: l.night_worker || '',
          nightShiftHours: Number(l.night_shift_hours) || 0,
          nightMeters: Number(l.night_meters) || 0,
          picks: Number(l.picks) || 0,
          product: l.product || '',
          totalMeters: Number(l.total_meters) || 0,
          takaSerial: l.taka_serial || null,
          foldingDate: l.folding_date || null,
          takaWeight: l.taka_weight !== null ? Number(l.taka_weight) : null,
          takaAssignId: l.taka_assign_id || null,
          isTpRoll: Boolean(l.is_tp_roll),
          tpSourceSerials: Array.isArray(l.tp_source_serials) ? l.tp_source_serials : []
        }));
      } catch(e) {
        console.error('fetchWeavingProductionRelational error:', e);
        return null;
      }
    },

    async deleteWeavingProductionLogRelational(logId) {
      if (!logId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_weaving_production_logs?id=eq.${encodeURIComponent(logId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Yarn Production & Sales Relational APIs ---
    async fetchYarnProductionRelational(division) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const query = division ? `division=eq.${encodeURIComponent(division)}&order=date.desc` : 'order=date.desc';
        const rows = await fetchAllRowsPaginated('vf_yarn_production_logs', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(yp => ({
          id: yp.id,
          division: yp.division,
          date: yp.date,
          boriNo: yp.bori_no,
          productName: yp.product_name,
          productId: yp.product_id || '',
          lotNo: yp.lot_no || '',
          color: yp.color || '',
          denier: yp.denier !== null ? Number(yp.denier) : '',
          tpm: yp.tpm !== null ? Number(yp.tpm) : '',
          twist: yp.twist || '',
          rolls: Number(yp.rolls) || 0,
          grossWeight: yp.gross_weight !== null && yp.gross_weight !== undefined ? Number(yp.gross_weight) : 0,
          tareWeight: yp.tare_weight !== null && yp.tare_weight !== undefined ? Number(yp.tare_weight) : 0,
          qty: Number(yp.qty) || 0,
          configType: yp.config_type || '',
          ply: yp.ply || '',
          yarns: Array.isArray(yp.yarns) ? yp.yarns : []
        }));
      } catch(e) {
        console.error('fetchYarnProductionRelational error:', e);
        return null;
      }
    },

    async deleteYarnProductionLogRelational(logId) {
      if (!logId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_production_logs?id=eq.${encodeURIComponent(logId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchYarnSalesRelational(division) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const query = division ? `division=eq.${encodeURIComponent(division)}&order=sale_date.desc` : 'order=sale_date.desc';
        const rows = await fetchAllRowsPaginated('vf_yarn_sales_logs', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(ys => {
          const raw = (ys.raw_data && typeof ys.raw_data === 'object') ? ys.raw_data : {};
          const totalGross = (ys.total_gross_weight !== null && ys.total_gross_weight !== undefined) ? Number(ys.total_gross_weight) : ((raw.totalGrossWeight !== undefined && raw.totalGrossWeight !== null) ? Number(raw.totalGrossWeight) : (Number(raw.grossWeight) || 0));
          const totalTare = (ys.total_tare_weight !== null && ys.total_tare_weight !== undefined) ? Number(ys.total_tare_weight) : ((raw.totalTareWeight !== undefined && raw.totalTareWeight !== null) ? Number(raw.totalTareWeight) : (Number(raw.tareWeight) || 0));
          return {
            id: ys.id,
            division: ys.division,
            saleDate: ys.sale_date,
            date: ys.sale_date,
            challanNo: ys.challan_no || raw.challanNo || '',
            customerName: ys.customer_name || raw.customerName || '',
            customer: ys.customer_name || raw.customerName || '',
            customerAddress: ys.customer_address || raw.customerAddress || 'Industrial Area, Surat, Gujarat, India',
            sellerCompanyId: ys.seller_company_id || raw.sellerCompanyId || '',
            sellerName: ys.seller_name || raw.sellerName || 'Vishwa Fashions',
            items: Array.isArray(ys.items) && ys.items.length > 0 ? ys.items : (Array.isArray(raw.items) ? raw.items : []),
            totalGrossWeight: totalGross,
            totalTareWeight: totalTare,
            grossWeight: totalGross,
            tareWeight: totalTare,
            totalQty: Number(ys.total_qty || raw.totalQty || raw.saleQty) || 0,
            saleQty: Number(ys.total_qty || raw.totalQty || raw.saleQty) || 0,
            qty: Number(ys.total_qty || raw.totalQty || raw.saleQty) || 0,
            totalAmount: Number(ys.total_amount || raw.totalAmount || raw.amount) || 0,
            amount: Number(ys.total_amount || raw.totalAmount || raw.amount) || 0,
            gstAmount: Number(ys.gst_amount || raw.gstAmount || raw.gst) || 0,
            gst: Number(ys.gst_amount || raw.gstAmount || raw.gst) || 0,
            ...raw
          };
        });
      } catch(e) {
        console.error('fetchYarnSalesRelational error:', e);
        return null;
      }
    },

    async deleteYarnSaleLogRelational(saleId) {
      if (!saleId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_sales_logs?id=eq.${encodeURIComponent(saleId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Fabric Dispatches & Outsource Pipeline Relational APIs ---
    async fetchFabricDispatchesRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_fabric_dispatches', '*', 'order=created_at.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const result = {};
        rows.forEach(d => {
          if (!d.taka_serial) return;
          result[d.taka_serial] = {
            status: d.status || 'Warehouse',
            currentStage: d.current_stage || 'Warehouse',
            vendor: d.vendor || '',
            customer: d.customer || '',
            invoice: d.invoice_no || '',
            challan: d.challan_no || '',
            dispatchDate: d.dispatch_date || '',
            rate: d.selling_rate !== null ? Number(d.selling_rate) : '',
            isPartialPiece: Boolean(d.is_partial_piece),
            history: Array.isArray(d.history) ? d.history : []
          };
        });
        return result;
      } catch(e) {
        console.error('fetchFabricDispatchesRelational error:', e);
        return null;
      }
    },

    async deleteFabricDispatchRelational(takaSerial) {
      if (!takaSerial || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_fabric_dispatches?taka_serial=eq.${encodeURIComponent(takaSerial)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Fabric Cut Relations Relational APIs ---
    async fetchFabricCutRelationsRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_fabric_cut_relations', '*', 'order=created_at.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const result = {};
        rows.forEach(c => {
          if (!c.parent_serial) return;
          if (c.metadata && typeof c.metadata === 'object' && Object.keys(c.metadata).length > 0) {
            result[c.parent_serial] = c.metadata;
          } else {
            result[c.parent_serial] = Array.isArray(c.children) ? c.children : [];
          }
        });
        return result;
      } catch(e) {
        console.error('fetchFabricCutRelationsRelational error:', e);
        return null;
      }
    },

    async deleteFabricCutRelationRelational(parentSerial) {
      if (!parentSerial || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_fabric_cut_relations?id=eq.${encodeURIComponent(parentSerial)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Staff, Attendance & Salary Sheet Relational APIs ---
    async fetchEmployeesRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_employees', '*', 'order=name.asc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(emp => {
          const meta = (emp.metadata && typeof emp.metadata === 'object') ? emp.metadata : {};
          const machines = Array.isArray(emp.assigned_machines) && emp.assigned_machines.length > 0
            ? emp.assigned_machines
            : (Array.isArray(meta.machines) ? meta.machines : []);
          const salAmount = Number(emp.salary_amount ?? emp.base_salary ?? emp.salary_rate ?? meta.salaryAmount ?? 0);
          const avatar = emp.avatar_color || emp.avatar_gradient || meta.avatarColor || meta.avatarGradient || 'from-purple-500 to-indigo-500';
          const jDate = emp.join_date || emp.joining_date || meta.joinDate || meta.joiningDate || '';
          const empStatus = emp.status || meta.status || (emp.active !== false ? 'Active' : 'Terminated');
          const idFrontImg = emp.id_front || meta.idFront || '';
          const idBackImg = emp.id_back || meta.idBack || '';
          const termDate = emp.termination_date || meta.terminationDate || null;
          const rejDate = emp.rejoin_date || meta.rejoinDate || null;

          return {
            id: emp.id,
            name: emp.name,
            role: emp.role,
            department: emp.department || '',
            salaryStyle: emp.salary_style || 'Per Day Fixed',
            salaryAmount: salAmount,
            salaryRate: Number(emp.salary_rate) || salAmount,
            baseSalary: Number(emp.base_salary) || salAmount,
            phone: emp.phone || '',
            email: emp.email || '',
            joinDate: jDate,
            joiningDate: jDate ? String(jDate).split('T')[0] : '',
            machines: machines,
            assignedMachines: machines,
            avatarColor: avatar,
            avatarGradient: avatar,
            status: empStatus,
            active: empStatus !== 'Terminated',
            idFront: idFrontImg,
            idBack: idBackImg,
            terminationDate: termDate,
            rejoinDate: rejDate,
            ...meta
          };
        });
      } catch(e) {
        console.error('fetchEmployeesRelational error:', e);
        return null;
      }
    },

    async deleteEmployeeRelational(empId) {
      if (!empId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_employees?id=eq.${encodeURIComponent(empId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchAttendanceRelational(startDate, endDate) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        let query = 'order=attendance_date.desc';
        if (startDate && endDate) {
          query = `attendance_date=gte.${startDate}&attendance_date=lte.${endDate}&order=attendance_date.desc`;
        }
        const rows = await fetchAllRowsPaginated('vf_attendance_records', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const result = {};
        rows.forEach(att => {
          const date = att.attendance_date;
          const empId = att.employee_id;
          if (!date || !empId) return;
          if (!result[date]) result[date] = {};
          result[date][empId] = {
            status: att.status || 'Present',
            shift: att.shift || 'Day',
            hours: Number(att.hours) || 0,
            overtime: Number(att.overtime_hours) || 0,
            meters: Number(att.meters) || 0,
            rate: Number(att.rate) || 0,
            earned: Number(att.total_earned) || 0,
            notes: att.notes || '',
            ...(att.metadata && typeof att.metadata === 'object' ? att.metadata : {})
          };
        });
        return result;
      } catch(e) {
        console.error('fetchAttendanceRelational error:', e);
        return null;
      }
    },

    async deleteAttendanceRecordRelational(recordId) {
      if (!recordId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?id=eq.${encodeURIComponent(recordId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchEmployeeLoansRelational(employeeId) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const query = employeeId ? `employee_id=eq.${encodeURIComponent(employeeId)}&order=loan_date.desc` : 'order=loan_date.desc';
        const rows = await fetchAllRowsPaginated('vf_employee_loans', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(ln => ({
          id: ln.id,
          empId: ln.employee_id,
          date: ln.loan_date,
          amount: Number(ln.amount) || 0,
          type: ln.type || 'Advance',
          reason: ln.reason || '',
          cleared: Boolean(ln.cleared)
        }));
      } catch(e) {
        console.error('fetchEmployeeLoansRelational error:', e);
        return null;
      }
    },

    async deleteEmployeeLoanRelational(loanId) {
      if (!loanId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_employee_loans?id=eq.${encodeURIComponent(loanId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchSalarySettlementsRelational(monthYear) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const query = monthYear ? `month_year=eq.${encodeURIComponent(monthYear)}&order=created_at.desc` : 'order=month_year.desc';
        const rows = await fetchAllRowsPaginated('vf_salary_settlements', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const result = {};
        rows.forEach(st => {
          const m = st.month_year;
          const empId = st.employee_id;
          if (!m || !empId) return;
          if (!result[m]) result[m] = {};
          result[m][empId] = {
            paidAmount: Number(st.paid_amount) || 0,
            netPayable: Number(st.net_payable) || 0,
            paidDate: st.paid_date || '',
            paymentMode: st.payment_mode || '',
            status: st.status || 'Paid',
            ...(st.details && typeof st.details === 'object' ? st.details : {})
          };
        });
        return result;
      } catch(e) {
        console.error('fetchSalarySettlementsRelational error:', e);
        return null;
      }
    },

    async deleteSalarySettlementRelational(settlementId) {
      if (!settlementId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_salary_settlements?id=eq.${encodeURIComponent(settlementId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },
    // --- Enterprise Yarn RM Orders Relational APIs ---
    async fetchYarnOrdersRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const dbOrders = await fetchAllRowsPaginated('vf_yarn_orders', '*', 'order=order_date.desc');
        const dbBatches = await fetchAllRowsPaginated('vf_yarn_order_batches', '*', 'order=receive_date.desc');
        const dbBoxes = await fetchAllRowsPaginated('vf_yarn_order_boxes', '*', 'order=box_number.asc');
        if (!Array.isArray(dbOrders) || dbOrders.length === 0) return null;

        const boxesByBatch = new Map();
        (dbBoxes || []).forEach(bx => {
          if (!boxesByBatch.has(bx.batch_id)) boxesByBatch.set(bx.batch_id, []);
          boxesByBatch.get(bx.batch_id).push({
            boxNumber: bx.box_number,
            weight: Number(bx.weight) || 0,
            cones: bx.cones || 0,
            returnedWeight: Number(bx.returned_weight) || 0,
            returnedDate: bx.returned_date || null,
            returnReason: bx.return_reason || null
          });
        });

        const batchesByOrder = new Map();
        (dbBatches || []).forEach(b => {
          if (!batchesByOrder.has(b.order_id)) batchesByOrder.set(b.order_id, []);
          batchesByOrder.get(b.order_id).push({
            id: b.id,
            challanNumber: b.challan_number || '',
            lotNumber: b.lot_number || '',
            receiveDate: b.receive_date || '',
            totalWeight: Number(b.total_weight) || 0,
            notes: b.notes || '',
            boxes: boxesByBatch.get(b.id) || []
          });
        });

        return dbOrders.map(o => ({
          id: o.id,
          orderNumber: o.order_number,
          orderDate: o.order_date,
          supplier: o.supplier,
          category: o.category || 'Polyester',
          type: o.category || 'Polyester',
          quality: o.quality,
          code: o.code || '',
          color: o.color || '',
          orderedWeight: Number(o.ordered_weight) || 0,
          price: Number(o.price) || 0,
          status: o.status || 'Active',
          remarks: o.remarks || '',
          batches: batchesByOrder.get(o.id) || [],
          updated_at: o.updated_at || o.updatedAt || null,
          updatedAt: o.updated_at || o.updatedAt || null
        }));
      } catch (e) {
        console.error('fetchYarnOrdersRelational error:', e);
        return null;
      }
    },

    async deleteYarnOrderRelational(orderId) {
      if (!orderId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_orders?id=eq.${encodeURIComponent(orderId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Yarn RM Stock Relational APIs ---
    async fetchYarnStockRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const lots = await fetchAllRowsPaginated('vf_yarn_rm_lots', '*', 'order=receive_date.desc');
        const boxes = await fetchAllRowsPaginated('vf_yarn_rm_boxes', '*', 'order=box_number.asc');
        if (!Array.isArray(lots) || lots.length === 0) return null;

        const boxesByLot = new Map();
        (boxes || []).forEach(b => {
          if (!boxesByLot.has(b.lot_id)) boxesByLot.set(b.lot_id, []);
          boxesByLot.get(b.lot_id).push({
            id: b.box_number || b.id,
            boxNumber: b.box_number,
            cones: b.cones || 0,
            grossWeight: Number(b.gross_weight) || 0,
            remainingWeight: Number(b.remaining_weight) || 0,
            weight: Number(b.active_weight) || 0,
            status: b.status || 'available',
            issueDate: b.issue_date || null,
            issuedTo: b.issued_to || null,
            grDate: b.gr_date || null,
            grWeight: Number(b.gr_weight) || 0,
            grRemarks: b.gr_remarks || null
          });
        });

        return lots.map(l => ({
          id: l.id,
          batchId: l.batch_id || '',
          lotNumber: l.lot_number,
          challanNo: l.challan_number || '',
          challanNumber: l.challan_number || '',
          receiveDate: l.receive_date,
          date: l.receive_date,
          supplier: l.supplier,
          quality: l.quality,
          itemType: l.item_type || 'Polyester',
          code: l.code || '',
          color: l.color || '',
          rate: Number(l.rate) || 0,
          orderRef: l.order_ref || '',
          notes: l.notes || '',
          boxes: boxesByLot.get(l.id) || []
        }));
      } catch (e) {
        console.error('fetchYarnStockRelational error:', e);
        return null;
      }
    },

    async issueYarnBoxesAtomic(boxUids, issueData = {}) {
      if (!Array.isArray(boxUids) || boxUids.length === 0) return { success: false, error: 'No boxes specified' };
      const { issuedTo = 'General', issueDate = new Date().toISOString().split('T')[0], remarks = '' } = issueData;
      const user = getLocalUserInfo().name || 'Operator';

      if (activeConfig.isConfigured && SUPABASE_URL) {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_issue_yarn_boxes`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              p_box_ids: boxUids,
              p_issued_to: issuedTo,
              p_issue_date: issueDate,
              p_user: user,
              p_remarks: remarks
            })
          });

          if (res.ok) {
            const data = await res.json();
            return data;
          }
        } catch (e) {
          console.warn('RPC vf_issue_yarn_boxes fallback to local update:', e);
        }
      }
      return { success: true, fallback: true };
    },

    async deleteYarnLotRelational(lotId) {
      if (!lotId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_lots?id=eq.${encodeURIComponent(lotId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchYarnTransactions(lotId = null) {
      if (!activeConfig.isConfigured || !SUPABASE_URL) return [];
      try {
        let url = 'vf_yarn_rm_transactions?select=*&order=created_at.desc';
        if (lotId) url += `&lot_id=eq.${encodeURIComponent(lotId)}`;
        return await fetchAllRowsPaginated(url);
      } catch (e) {
        return [];
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
    sendPresencePing: (...args) => sendPresencePing(...args),
    sendPresenceLeave: () => sendPresenceLeave(),
    broadcastFieldFocus: (fieldId, isFocused, meta) => broadcastFieldFocus(fieldId, isFocused, meta),
    broadcastFieldChange: (fieldId, value, meta) => broadcastFieldChange(fieldId, value, meta),
    broadcastFormClear: (fieldIds) => broadcastFormClear(fieldIds),
    broadcastActiveFormSnapshot: (container) => {
      if (typeof window.__vf_broadcastActiveFormSnapshot === 'function') {
        window.__vf_broadcastActiveFormSnapshot(container);
      }
    },
    mergeDatasets: (key, localVal, remoteVal) => mergeDatasets(key, localVal, remoteVal),
    mergeYarnSalesDatasets: mergeYarnSalesDatasets,
    mergeYarnProductionDatasets: mergeYarnProductionDatasets,
    mergeYarnLedgerDatasets: mergeYarnLedgerDatasets,
    mergeYarnStockDatasets: mergeYarnStockDatasets,
    mergeYarnOrdersDatasets: mergeYarnOrdersDatasets,
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

  // Smart polling interval & Visibility Throttling (2s fast polling for instant cross-PC updates without refresh)
  let syncIntervalId = null;
  const POLL_INTERVAL_MS = 2000;

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

      // Guard against pre-hydration empty state overwriting cloud tables
      if (!isHydrated && (valStr === '[]' || valStr === '{}')) {
        return;
      }

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

  // ==============================================================================
  // Modern Asynchronous Relational Service Layer (window.VF_DB)
  // Direct async CRUD operations against Supabase Postgres with auto-pagination & offline resilience
  // ==============================================================================
  const VF_DB = {
    // Check if Supabase connection is configured and active
    isConfigured: () => Boolean(activeConfig.isConfigured && SUPABASE_URL && SUPABASE_ANON_KEY),
    getStatus: () => currentStatus,

    // Generic Auto-Paginated Table Fetcher (>1000 Rows Safe)
    async fetchTable(tableName, options = {}) {
      const select = options.select || '*';
      const order = options.order ? `&order=${encodeURIComponent(options.order)}` : '';
      const filter = options.filter ? `&${options.filter}` : '';
      const extra = `${order}${filter}`;
      return await fetchAllRows(tableName, select, extra);
    },

    // Generic Batch Upsert Helper (Chunks of 50 for Network Safety)
    async upsert(tableName, records, onConflict = 'id') {
      if (!this.isConfigured()) return { success: false, error: 'Database unconfigured' };
      const list = Array.isArray(records) ? records : [records];
      if (list.length === 0) return { success: true, count: 0 };

      const batchSize = 50;
      let upsertedCount = 0;

      for (let i = 0; i < list.length; i += batchSize) {
        const chunk = list.slice(i, i + batchSize).map(item => {
          const rec = { ...item };
          if (!rec.updated_at) rec.updated_at = new Date().toISOString();
          return rec;
        });

        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?on_conflict=${encodeURIComponent(onConflict)}`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(chunk)
          });

          if (!res.ok) {
            const errText = await res.text();
            console.error(`VF_DB.upsert error on ${tableName}:`, errText);
            return { success: false, error: errText, count: upsertedCount };
          }
          upsertedCount += chunk.length;
        } catch (err) {
          console.error(`VF_DB.upsert network exception on ${tableName}:`, err);
          return { success: false, error: err.message, count: upsertedCount };
        }
      }

      return { success: true, count: upsertedCount };
    },

    // Generic Delete by Column Value
    async delete(tableName, colName = 'id', colVal) {
      if (!this.isConfigured()) return { success: false, error: 'Database unconfigured' };
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?${encodeURIComponent(colName)}=eq.${encodeURIComponent(colVal)}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        return { success: res.ok, status: res.status };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    // --- Yarn Division APIs ---
    yarn: {
      async getLots(options = {}) {
        const lots = await VF_DB.fetchTable('vf_yarn_rm_lots', { order: 'receive_date.desc,updated_at.desc', ...options });
        const boxes = await VF_DB.fetchTable('vf_yarn_rm_boxes', { ...options });
        const boxMap = new Map();
        boxes.forEach(b => {
          if (!boxMap.has(b.lot_id)) boxMap.set(b.lot_id, []);
          boxMap.get(b.lot_id).push(b);
        });
        return lots.map(l => ({
          ...l,
          lotNumber: l.lot_number,
          challanNo: l.challan_number,
          receiveDate: l.receive_date,
          itemType: l.item_type,
          orderRef: l.order_ref,
          totalBoxes: l.total_boxes,
          grossWeight: l.gross_weight,
          boxes: (boxMap.get(l.id) || []).map(b => ({
            ...b,
            boxNumber: b.box_number,
            grossWeight: b.gross_weight,
            remainingWeight: b.remaining_weight,
            activeWeight: b.active_weight,
            issueDate: b.issue_date,
            issuedTo: b.issued_to,
            grDate: b.gr_date,
            grWeight: b.gr_weight,
            grRemarks: b.gr_remarks
          }))
        }));
      },
      async saveLot(lot) {
        if (!lot) return { success: false };
        const lotId = lot.id || `LOT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const lotRow = {
          id: lotId,
          batch_id: lot.batchId || lot.batch_id || null,
          lot_number: lot.lotNumber || lot.lot_number || '',
          challan_number: lot.challanNo || lot.challan_number || lot.challanNumber || null,
          receive_date: lot.receiveDate || lot.receive_date || new Date().toISOString().split('T')[0],
          supplier: lot.supplier || '',
          quality: lot.quality || '',
          item_type: lot.itemType || lot.item_type || 'Polyester',
          code: lot.code || null,
          color: lot.color || null,
          rate: Number(lot.rate) || 0,
          order_ref: lot.orderRef || lot.order_ref || null,
          total_boxes: Array.isArray(lot.boxes) ? lot.boxes.length : (Number(lot.totalBoxes) || 0),
          gross_weight: Number(lot.grossWeight || lot.gross_weight) || 0,
          notes: lot.notes || null,
          updated_at: new Date().toISOString()
        };

        const lotRes = await VF_DB.upsert('vf_yarn_rm_lots', lotRow);
        if (!lotRes.success) return lotRes;

        if (Array.isArray(lot.boxes) && lot.boxes.length > 0) {
          const boxRows = lot.boxes.map((b, idx) => ({
            id: b.id || `${lotId}-BX-${b.boxNumber || idx + 1}`,
            lot_id: lotId,
            box_number: String(b.boxNumber || b.box_number || idx + 1),
            cones: Number(b.cones) || 0,
            gross_weight: Number(b.grossWeight || b.gross_weight || b.weight) || 0,
            remaining_weight: Number(b.remainingWeight || b.remaining_weight || b.activeWeight || b.grossWeight || b.weight) || 0,
            active_weight: Number(b.activeWeight || b.active_weight || b.remainingWeight || b.grossWeight || b.weight) || 0,
            status: b.status || 'available',
            issue_date: b.issueDate || b.issue_date || null,
            issued_to: b.issuedTo || b.issued_to || null,
            gr_date: b.grDate || b.gr_date || null,
            gr_weight: Number(b.grWeight || b.gr_weight) || 0,
            gr_remarks: b.grRemarks || b.gr_remarks || null,
            updated_at: new Date().toISOString()
          }));
          await VF_DB.upsert('vf_yarn_rm_boxes', boxRows);
        }
        return { success: true, id: lotId };
      },
      async deleteLot(id) {
        return await VF_DB.delete('vf_yarn_rm_lots', 'id', id);
      },
      async issueBoxes(boxIds, issuedTo, issueDate = null, user = 'Operator', remarks = '') {
        const bList = Array.isArray(boxIds) ? boxIds : [boxIds];
        const dateStr = issueDate || new Date().toISOString().split('T')[0];
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_issue_yarn_boxes`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              p_box_ids: bList,
              p_issued_to: issuedTo,
              p_issue_date: dateStr,
              p_user: user,
              p_remarks: remarks
            })
          });
          if (res.ok) return await res.json();
        } catch(e) {}
        // Fallback manual update if RPC is missing
        const boxRows = bList.map(bId => ({
          id: bId,
          status: 'issued',
          issued_to: issuedTo,
          issue_date: dateStr,
          updated_at: new Date().toISOString()
        }));
        return await VF_DB.upsert('vf_yarn_rm_boxes', boxRows);
      },
      async getOrders(options = {}) {
        const orders = await VF_DB.fetchTable('vf_yarn_orders', { order: 'order_date.desc,updated_at.desc', ...options });
        const batches = await VF_DB.fetchTable('vf_yarn_order_batches', { ...options });
        const boxes = await VF_DB.fetchTable('vf_yarn_order_boxes', { ...options });

        const batchBoxMap = new Map();
        boxes.forEach(bx => {
          if (!batchBoxMap.has(bx.batch_id)) batchBoxMap.set(bx.batch_id, []);
          batchBoxMap.get(bx.batch_id).push(bx);
        });

        const orderBatchMap = new Map();
        batches.forEach(b => {
          if (!orderBatchMap.has(b.order_id)) orderBatchMap.set(b.order_id, []);
          orderBatchMap.get(b.order_id).push({
            ...b,
            challanNumber: b.challan_number,
            lotNumber: b.lot_number,
            receiveDate: b.receive_date,
            totalWeight: b.total_weight,
            boxes: (batchBoxMap.get(b.id) || []).map(bx => ({
              ...bx,
              boxNumber: bx.box_number,
              returnedWeight: bx.returned_weight,
              returnedDate: bx.returned_date,
              returnReason: bx.return_reason
            }))
          });
        });

        return orders.map(ord => ({
          ...ord,
          orderNumber: ord.order_number,
          orderDate: ord.order_date,
          orderedWeight: ord.ordered_weight,
          batches: orderBatchMap.get(ord.id) || []
        }));
      },
      async saveOrder(order) {
        if (!order) return { success: false };
        const orderId = order.id || `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const orderRow = {
          id: orderId,
          order_number: order.orderNumber || order.order_number || '',
          order_date: order.orderDate || order.order_date || new Date().toISOString().split('T')[0],
          supplier: order.supplier || '',
          category: order.category || 'Polyester',
          quality: order.quality || '',
          code: order.code || null,
          color: order.color || null,
          ordered_weight: Number(order.orderedWeight || order.ordered_weight) || 0,
          price: Number(order.price) || 0,
          status: order.status || 'Active',
          remarks: order.remarks || null,
          updated_at: new Date().toISOString()
        };

        const res = await VF_DB.upsert('vf_yarn_orders', orderRow);
        if (!res.success) return res;

        if (Array.isArray(order.batches)) {
          for (const b of order.batches) {
            const batchId = b.id || `BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            await VF_DB.upsert('vf_yarn_order_batches', {
              id: batchId,
              order_id: orderId,
              challan_number: b.challanNumber || b.challan_number || '',
              lot_number: b.lotNumber || b.lot_number || '',
              receive_date: b.receiveDate || b.receive_date || new Date().toISOString().split('T')[0],
              total_weight: Number(b.totalWeight || b.total_weight) || 0,
              notes: b.notes || null,
              updated_at: new Date().toISOString()
            });

            if (Array.isArray(b.boxes)) {
              const boxRows = b.boxes.map((bx, idx) => ({
                id: bx.id || `${batchId}-BX-${bx.boxNumber || idx + 1}`,
                batch_id: batchId,
                order_id: orderId,
                box_number: String(bx.boxNumber || bx.box_number || idx + 1),
                weight: Number(bx.weight) || 0,
                cones: Number(bx.cones) || 0,
                returned_weight: Number(bx.returnedWeight || bx.returned_weight) || 0,
                returned_date: bx.returnedDate || bx.returned_date || null,
                return_reason: bx.returnReason || bx.return_reason || null,
                updated_at: new Date().toISOString()
              }));
              await VF_DB.upsert('vf_yarn_order_boxes', boxRows);
            }
          }
        }
        return { success: true, id: orderId };
      },
      async deleteOrder(id) {
        return await VF_DB.delete('vf_yarn_orders', 'id', id);
      },
      async getProduction(division, options = {}) {
        const filter = division ? `division=eq.${encodeURIComponent(division)}` : '';
        return await VF_DB.fetchTable('vf_yarn_production_logs', { order: 'date.desc,created_at.desc', filter: filter, ...options });
      },
      async saveProduction(division, log) {
        if (!log) return { success: false };
        const id = log.id || `YPROD-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const row = {
          id: id,
          division: division || log.division || 'covering',
          date: log.date || new Date().toISOString().split('T')[0],
          bori_no: String(log.boriNo || log.bori_no || ''),
          product_name: log.productName || log.product_name || '',
          product_id: log.productId || log.product_id || null,
          lot_no: log.lotNo || log.lot_no || null,
          color: log.color || null,
          denier: Number(log.denier) || null,
          tpm: Number(log.tpm) || null,
          twist: log.twist || null,
          rolls: Number(log.rolls) || 0,
          gross_weight: Number(log.grossWeight || log.gross_weight) || 0,
          tare_weight: Number(log.tareWeight || log.tare_weight) || 0,
          qty: Number(log.qty || log.netWeight || log.net_weight) || 0,
          config_type: log.configType || log.config_type || null,
          ply: log.ply || null,
          yarns: Array.isArray(log.yarns) ? log.yarns : [],
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_yarn_production_logs', row);
      },
      async deleteProduction(id) {
        return await VF_DB.delete('vf_yarn_production_logs', 'id', id);
      },
      async getSales(division, options = {}) {
        const filter = division ? `division=eq.${encodeURIComponent(division)}` : '';
        return await VF_DB.fetchTable('vf_yarn_sales_logs', { order: 'sale_date.desc,created_at.desc', filter: filter, ...options });
      },
      async saveSale(division, sale) {
        if (!sale) return { success: false };
        const id = sale.id || `YSALE-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const row = {
          id: id,
          division: division || sale.division || 'covering',
          sale_date: sale.saleDate || sale.sale_date || sale.date || new Date().toISOString().split('T')[0],
          challan_no: sale.challanNo || sale.challan_no || null,
          customer_name: sale.customerName || sale.customer_name || sale.partyName || sale.customer || '',
          customer_address: sale.customerAddress || sale.customer_address || null,
          seller_company_id: sale.sellerCompanyId || sale.seller_company_id || null,
          seller_name: sale.sellerName || sale.seller_name || null,
          discount_type: sale.discountType || sale.discount_type || 'percent',
          discount_value: Number(sale.discountValue || sale.discount_value) || 0,
          discount_amount: Number(sale.discountAmount || sale.discount_amount) || 0,
          taxable_amount: Number(sale.taxableAmount || sale.taxable_amount) || 0,
          gst_rate: Number(sale.gstRate || sale.gst_rate) || 12,
          subtotal_amount: Number(sale.subtotalAmount || sale.subtotal_amount) || 0,
          items: Array.isArray(sale.items) ? sale.items : [],
          total_gross_weight: Number(sale.totalGrossWeight || sale.total_gross_weight) || 0,
          total_tare_weight: Number(sale.totalTareWeight || sale.total_tare_weight) || 0,
          total_qty: Number(sale.totalQty || sale.total_qty || sale.qty) || 0,
          total_amount: Number(sale.totalAmount || sale.total_amount || sale.amount) || 0,
          gst_amount: Number(sale.gstAmount || sale.gst_amount) || 0,
          raw_data: sale.rawData || sale.raw_data || {},
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_yarn_sales_logs', row);
      },
      async deleteSale(id) {
        return await VF_DB.delete('vf_yarn_sales_logs', 'id', id);
      },
      async getQualities() {
        return await VF_DB.fetchTable('vf_rm_qualities', { order: 'quality.asc' });
      },
      async saveQuality(q) {
        const id = q.id || `Q-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        return await VF_DB.upsert('vf_rm_qualities', { ...q, id, updated_at: new Date().toISOString() });
      },
      async deleteQuality(id) {
        return await VF_DB.delete('vf_rm_qualities', 'id', id);
      },
      async getFpQualities() {
        return await VF_DB.fetchTable('vf_fp_qualities', { order: 'name.asc' });
      },
      async saveFpQuality(q) {
        const id = q.id || `FPQ-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        return await VF_DB.upsert('vf_fp_qualities', { ...q, id, updated_at: new Date().toISOString() });
      },
      async deleteFpQuality(id) {
        return await VF_DB.delete('vf_fp_qualities', 'id', id);
      },
      async getSuppliers() {
        return await VF_DB.fetchTable('vf_rm_suppliers', { order: 'name.asc' });
      },
      async saveSupplier(s) {
        const id = s.id || `SUP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        return await VF_DB.upsert('vf_rm_suppliers', { ...s, id, updated_at: new Date().toISOString() });
      },
      async deleteSupplier(id) {
        return await VF_DB.delete('vf_rm_suppliers', 'id', id);
      }
    },

    // --- Weaving Division APIs ---
    weaving: {
      async getBeams(options = {}) {
        return await VF_DB.fetchTable('vf_warp_beams', { order: 'created_at.desc,updated_at.desc', ...options });
      },
      async saveBeam(beam) {
        if (!beam) return { success: false };
        const id = beam.id || `BEAM-${beam.beamNumber || Date.now()}`;
        const row = {
          id: id,
          beam_number: String(beam.beamNumber || beam.beam_number || ''),
          quality: beam.quality || '',
          code: beam.code || null,
          color: beam.color || null,
          meters: Number(beam.meters) || 0,
          ends: Number(beam.ends) || 0,
          status: beam.status || 'Available',
          machine_number: beam.machineNumber || beam.machine_number || null,
          warping_person: beam.warpingPerson || beam.warping_person || null,
          created_at: beam.createdAt || beam.created_at || new Date().toISOString().split('T')[0],
          history: Array.isArray(beam.history) ? beam.history : [],
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_warp_beams', row);
      },
      async deleteBeam(id) {
        return await VF_DB.delete('vf_warp_beams', 'id', id);
      },
      async getBeamLoadings(options = {}) {
        return await VF_DB.fetchTable('vf_warp_beam_loadings', { order: 'date.desc,created_at.desc', ...options });
      },
      async saveBeamLoading(loading) {
        if (!loading) return { success: false };
        const id = loading.id || `LOAD-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const row = {
          id: id,
          date: loading.date || new Date().toISOString().split('T')[0],
          piecein: loading.piecein || null,
          drawing_in: loading.drawingIn || loading.drawing_in || null,
          fani: loading.fani || null,
          drop_pin_jog: loading.dropPinJog || loading.drop_pin_jog || null,
          machine_number: loading.machineNumber || loading.machine_number || null,
          beam_number: loading.beamNumber || loading.beam_number || null,
          item_color: loading.itemColor || loading.item_color || null,
          meters: Number(loading.meters) || 0,
          ends: Number(loading.ends) || 0,
          rate: Number(loading.rate) || 0,
          payment_amount: Number(loading.paymentAmount || loading.payment_amount) || 0,
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_warp_beam_loadings', row);
      },
      async deleteBeamLoading(id) {
        return await VF_DB.delete('vf_warp_beam_loadings', 'id', id);
      },
      async getWeftIssues(options = {}) {
        return await VF_DB.fetchTable('vf_weft_issues', { order: 'date.desc,created_at.desc', ...options });
      },
      async saveWeftIssues(issues) {
        const list = Array.isArray(issues) ? issues : [issues];
        const rows = list.map(i => ({
          id: i.id || `WEFT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          date: i.date || new Date().toISOString().split('T')[0],
          quality: i.quality || '',
          supplier: i.supplier || '',
          code: i.code || null,
          color: i.color || null,
          box: String(i.box || ''),
          challan: i.challan || null,
          lot: i.lot || null,
          cones: Number(i.cones) || 0,
          net: Number(i.net || i.weight) || 0,
          details: i.details || null,
          updated_at: new Date().toISOString()
        }));
        return await VF_DB.upsert('vf_weft_issues', rows);
      },
      async deleteWeftIssue(id) {
        return await VF_DB.delete('vf_weft_issues', 'id', id);
      },
      async getWarpIssues(options = {}) {
        return await VF_DB.fetchTable('vf_warp_issues', { order: 'date.desc,created_at.desc', ...options });
      },
      async saveWarpIssue(issue) {
        if (!issue) return { success: false };
        const id = issue.id || `WARP-ISSUE-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const row = {
          id: id,
          date: issue.date || new Date().toISOString().split('T')[0],
          quality: issue.quality || '',
          code: issue.code || null,
          color: issue.color || null,
          issued_weight: Number(issue.issuedWeight || issue.issued_weight || issue.weight) || 0,
          details: issue.details || null,
          supplier: issue.supplier || null,
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_warp_issues', row);
      },
      async deleteWarpIssue(id) {
        return await VF_DB.delete('vf_warp_issues', 'id', id);
      },
      async getProductionLogs(options = {}) {
        return await VF_DB.fetchTable('vf_weaving_production_logs', { order: 'production_date.desc,created_at.desc', ...options });
      },
      async saveProductionLog(log) {
        if (!log) return { success: false };
        const id = log.id || `WLOG-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const row = {
          id: id,
          production_date: log.productionDate || log.production_date || log.date || new Date().toISOString().split('T')[0],
          machine_number: String(log.machineNumber || log.machine_number || log.machine || log.loomNo || ''),
          beam_number: log.beamNumber || log.beam_number || null,
          secondary_beam_number: log.secondaryBeamNumber || log.secondary_beam_number || null,
          pissing_date: log.pissingDate || log.pissing_date || null,
          pissing_person: log.pissingPerson || log.pissing_person || null,
          day_worker: log.dayWorker || log.day_worker || null,
          day_shift_hours: Number(log.dayShiftHours || log.day_shift_hours) || 0,
          day_meters: Number(log.dayMeters || log.day_meters) || 0,
          night_worker: log.nightWorker || log.night_worker || null,
          night_shift_hours: Number(log.nightShiftHours || log.night_shift_hours) || 0,
          night_meters: Number(log.nightMeters || log.night_meters) || 0,
          picks: Number(log.picks) || 0,
          product: log.product || log.productName || null,
          total_meters: Number(log.totalMeters || log.total_meters || (Number(log.dayMeters || 0) + Number(log.nightMeters || 0))) || 0,
          taka_serial: log.takaSerial || log.taka_serial || null,
          folding_date: log.foldingDate || log.folding_date || null,
          taka_weight: Number(log.takaWeight || log.taka_weight) || null,
          taka_assign_id: log.takaAssignId || log.taka_assign_id || null,
          is_tp_roll: Boolean(log.isTpRoll || log.is_tp_roll),
          tp_source_serials: Array.isArray(log.tpSourceSerials || log.tp_source_serials) ? (log.tpSourceSerials || log.tp_source_serials) : [],
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_weaving_production_logs', row);
      },
      async deleteProductionLog(id) {
        return await VF_DB.delete('vf_weaving_production_logs', 'id', id);
      },
      async getDispatches(options = {}) {
        return await VF_DB.fetchTable('vf_fabric_dispatches', { order: 'dispatch_date.desc,updated_at.desc', ...options });
      },
      async saveDispatch(disp) {
        if (!disp) return { success: false };
        const id = disp.id || `DISP-${disp.takaSerial || Date.now()}`;
        const row = {
          id: id,
          taka_serial: String(disp.takaSerial || disp.taka_serial || ''),
          status: disp.status || 'Warehouse',
          current_stage: disp.currentStage || disp.current_stage || 'Warehouse',
          vendor: disp.vendor || null,
          customer: disp.customer || null,
          invoice_no: disp.invoiceNo || disp.invoice_no || null,
          challan_no: disp.challanNo || disp.challan_no || null,
          dispatch_date: disp.dispatchDate || disp.dispatch_date || null,
          selling_rate: Number(disp.sellingRate || disp.selling_rate) || null,
          is_partial_piece: Boolean(disp.isPartialPiece || disp.is_partial_piece),
          history: Array.isArray(disp.history) ? disp.history : [],
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_fabric_dispatches', row);
      },
      async deleteDispatch(id) {
        return await VF_DB.delete('vf_fabric_dispatches', 'id', id);
      },
      async getCutRelations(options = {}) {
        return await VF_DB.fetchTable('vf_fabric_cut_relations', { order: 'updated_at.desc', ...options });
      },
      async saveCutRelation(rel) {
        if (!rel) return { success: false };
        const id = rel.id || `CUT-${rel.parentSerial || Date.now()}`;
        const row = {
          id: id,
          parent_serial: String(rel.parentSerial || rel.parent_serial || ''),
          children: Array.isArray(rel.children) ? rel.children : [],
          metadata: rel.metadata || {},
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_fabric_cut_relations', row);
      },
      async getDesigns(options = {}) {
        return await VF_DB.fetchTable('vf_fabric_designs', { order: 'design_name.asc', ...options });
      },
      async saveDesign(design) {
        if (!design) return { success: false };
        const id = design.id || `DES-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const row = {
          id: id,
          design_name: design.designName || design.design_name || design.name || '',
          design_number: design.designNumber || design.design_number || null,
          quality: design.quality || null,
          image_url: design.imageUrl || design.image_url || design.image || null,
          ep_file_url: design.epFileUrl || design.ep_file_url || null,
          picks: Number(design.picks) || 0,
          repeats: Number(design.repeats) || 1,
          total_hooks: Number(design.totalHooks || design.total_hooks) || 0,
          width: Number(design.width) || null,
          avg_weight: Number(design.avgWeight || design.avg_weight) || null,
          costing_id: design.costingId || design.costing_id || null,
          deleted: Boolean(design.deleted),
          metadata: design.metadata || {},
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_fabric_designs', row);
      },
      async deleteDesign(id) {
        return await VF_DB.delete('vf_fabric_designs', 'id', id);
      },
      async getMachinery(assetType = null) {
        const filter = assetType ? `asset_type=eq.${encodeURIComponent(assetType)}` : '';
        return await VF_DB.fetchTable('vf_machinery_assets', { order: 'name.asc', filter: filter });
      },
      async saveMachinery(asset) {
        if (!asset) return { success: false };
        const id = asset.id || `MACH-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const row = {
          id: id,
          asset_type: asset.assetType || asset.asset_type || asset.type || 'loom',
          name: asset.name || '',
          code: asset.code || null,
          model: asset.model || null,
          status: asset.status || 'Active',
          metadata: asset.metadata || {},
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_machinery_assets', row);
      },
      async deleteMachinery(id) {
        return await VF_DB.delete('vf_machinery_assets', 'id', id);
      }
    },

    // --- Staff & HR APIs ---
    staff: {
      async getEmployees(options = {}) {
        return await VF_DB.fetchTable('vf_employees', { order: 'name.asc', ...options });
      },
      async saveEmployee(emp) {
        if (!emp) return { success: false };
        const id = emp.id || `EMP-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const row = {
          id: id,
          name: emp.name || '',
          role: emp.role || 'Worker',
          department: emp.department || null,
          salary_style: emp.salaryStyle || emp.salary_style || 'Per Day Fixed',
          salary_rate: Number(emp.salaryRate || emp.salary_rate || emp.salaryAmount || emp.baseSalary) || 0,
          base_salary: Number(emp.baseSalary || emp.base_salary || emp.salaryRate || emp.salaryAmount) || 0,
          salary_amount: Number(emp.salaryAmount || emp.salary_amount || emp.salaryRate || emp.baseSalary) || 0,
          phone: emp.phone || null,
          email: emp.email || null,
          joining_date: emp.joiningDate || emp.joining_date || emp.joinDate || null,
          join_date: emp.joinDate ? (new Date(emp.joinDate).toISOString()) : null,
          termination_date: emp.terminationDate || emp.termination_date || null,
          rejoin_date: emp.rejoinDate || emp.rejoin_date || null,
          assigned_machines: Array.isArray(emp.assignedMachines || emp.assigned_machines || emp.machines) ? (emp.assignedMachines || emp.assigned_machines || emp.machines) : [],
          avatar_gradient: emp.avatarGradient || emp.avatar_gradient || null,
          avatar_color: emp.avatarColor || emp.avatar_color || null,
          id_front: emp.idFront || emp.id_front || null,
          id_back: emp.idBack || emp.id_back || null,
          status: emp.status || (emp.active === false ? 'Inactive' : 'Active'),
          active: emp.active !== false && emp.status !== 'Inactive',
          metadata: emp.metadata || {},
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_employees', row);
      },
      async deleteEmployee(id) {
        return await VF_DB.delete('vf_employees', 'id', id);
      },
      async getAttendance(options = {}) {
        return await VF_DB.fetchTable('vf_attendance_records', { order: 'attendance_date.desc,created_at.desc', ...options });
      },
      async saveAttendance(records) {
        const list = Array.isArray(records) ? records : [records];
        const rows = list.map(a => ({
          id: a.id || `ATT-${a.employee_id || a.employeeId}-${a.attendance_date || a.attendanceDate || a.date}-${Math.random().toString(36).substring(2, 6)}`,
          attendance_date: a.attendanceDate || a.attendance_date || a.date || new Date().toISOString().split('T')[0],
          employee_id: a.employeeId || a.employee_id || a.empId,
          status: a.status || 'Present',
          shift: a.shift || 'Day',
          hours: Number(a.hours) || 0,
          overtime_hours: Number(a.overtimeHours || a.overtime_hours) || 0,
          meters: Number(a.meters) || 0,
          rate: Number(a.rate) || 0,
          total_earned: Number(a.totalEarned || a.total_earned || a.earned) || 0,
          notes: a.notes || null,
          metadata: a.metadata || {},
          updated_at: new Date().toISOString()
        }));
        return await VF_DB.upsert('vf_attendance_records', rows);
      },
      async deleteAttendance(id) {
        return await VF_DB.delete('vf_attendance_records', 'id', id);
      },
      async getLoans(options = {}) {
        return await VF_DB.fetchTable('vf_employee_loans', { order: 'loan_date.desc,created_at.desc', ...options });
      },
      async saveLoan(loan) {
        if (!loan) return { success: false };
        const id = loan.id || `LOAN-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const row = {
          id: id,
          employee_id: loan.employeeId || loan.employee_id || loan.empId,
          loan_date: loan.loanDate || loan.loan_date || loan.date || new Date().toISOString().split('T')[0],
          amount: Number(loan.amount) || 0,
          type: loan.type || 'Advance',
          reason: loan.reason || null,
          cleared: Boolean(loan.cleared),
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_employee_loans', row);
      },
      async deleteLoan(id) {
        return await VF_DB.delete('vf_employee_loans', 'id', id);
      },
      async getSalarySettlements(options = {}) {
        return await VF_DB.fetchTable('vf_salary_settlements', { order: 'month_year.desc,created_at.desc', ...options });
      },
      async saveSalarySettlement(settlement) {
        if (!settlement) return { success: false };
        const id = settlement.id || `SETT-${settlement.employeeId || settlement.employee_id}-${settlement.monthYear || settlement.month_year}`;
        const row = {
          id: id,
          month_year: settlement.monthYear || settlement.month_year || '',
          employee_id: settlement.employeeId || settlement.employee_id || settlement.empId,
          paid_amount: Number(settlement.paidAmount || settlement.paid_amount) || 0,
          net_payable: Number(settlement.netPayable || settlement.net_payable) || 0,
          paid_date: settlement.paidDate || settlement.paid_date || new Date().toISOString().split('T')[0],
          payment_mode: settlement.paymentMode || settlement.payment_mode || 'Cash',
          status: settlement.status || 'Paid',
          details: settlement.details || {},
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_salary_settlements', row);
      },
      async deleteSalarySettlement(id) {
        return await VF_DB.delete('vf_salary_settlements', 'id', id);
      }
    },

    // --- Costing APIs ---
    costing: {
      async getProducts(type = 'weaving') {
        const table = type === 'tfo' ? 'vf_costing_tfo_products' :
                      type === 'doubler' ? 'vf_costing_doubler_products' :
                      type === 'covering' ? 'vf_costing_covering_products' : 'vf_costing_products';
        const rows = await VF_DB.fetchTable(table, { order: 'updated_at.desc' });
        return rows.map(r => ({ id: r.id, ...(r.data || {}) }));
      },
      async saveProduct(type = 'weaving', product) {
        if (!product || !product.id) return { success: false };
        const table = type === 'tfo' ? 'vf_costing_tfo_products' :
                      type === 'doubler' ? 'vf_costing_doubler_products' :
                      type === 'covering' ? 'vf_costing_covering_products' : 'vf_costing_products';
        const row = {
          id: String(product.id),
          data: product,
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert(table, row);
      },
      async deleteProduct(type = 'weaving', id) {
        const table = type === 'tfo' ? 'vf_costing_tfo_products' :
                      type === 'doubler' ? 'vf_costing_doubler_products' :
                      type === 'covering' ? 'vf_costing_covering_products' : 'vf_costing_products';
        return await VF_DB.delete(table, 'id', String(id));
      }
    },

    // --- Companies API ---
    companies: {
      async getCompanies() {
        return await VF_DB.fetchTable('vf_companies', { order: 'name.asc' });
      },
      async saveCompany(comp) {
        if (!comp) return { success: false };
        const id = comp.id || `COMP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const row = {
          id: id,
          name: comp.name || '',
          gstin: comp.gstin || null,
          address: comp.address || null,
          phone: comp.phone || null,
          email: comp.email || null,
          bank_details: comp.bankDetails || comp.bank_details || {},
          is_default: Boolean(comp.isDefault || comp.is_default),
          metadata: comp.metadata || {},
          updated_at: new Date().toISOString()
        };
        return await VF_DB.upsert('vf_companies', row);
      },
      async deleteCompany(id) {
        return await VF_DB.delete('vf_companies', 'id', id);
      }
    },

    // --- Audit & Security Logs ---
    audit: {
      async log(action, entityType, entityId, details = {}, userEmail = null) {
        if (!VF_DB.isConfigured()) return;
        try {
          const uEmail = userEmail || nativeLocalStorage.getItem('vf_user_name') || 'system';
          await fetch(`${SUPABASE_URL}/rest/v1/vf_audit_logs`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              user_email: uEmail,
              action: action,
              entity_type: entityType,
              entity_id: String(entityId || ''),
              details: details,
              created_at: new Date().toISOString()
            })
          });
        } catch(e) {}
      },
      async getLogs(options = {}) {
        return await VF_DB.fetchTable('vf_audit_logs', { order: 'created_at.desc', ...options });
      }
    },

    // --- 1-Click Pre-Migration Offline JSON Backup ---
    async exportFullBackup() {
      const backup = {
        meta: {
          export_date: new Date().toISOString(),
          version: '2.0.0',
          app: 'Vishwa Fashions Management Suite'
        },
        local_storage_raw: {},
        supabase_relational: {}
      };

      // 1. Gather all local storage keys
      try {
        for (let i = 0; i < nativeLocalStorage.length; i++) {
          const k = nativeLocalStorage.key(i);
          if (k) backup.local_storage_raw[k] = nativeLocalStorage.getItem(k);
        }
      } catch(e) {}

      // 2. Gather cloud relational tables if configured
      if (this.isConfigured()) {
        const tables = [
          'vf_yarn_rm_lots', 'vf_yarn_rm_boxes', 'vf_yarn_orders', 'vf_yarn_order_batches', 'vf_yarn_order_boxes',
          'vf_yarn_production_logs', 'vf_yarn_sales_logs', 'vf_warp_beams', 'vf_warp_issues', 'vf_warp_beam_loadings',
          'vf_weft_issues', 'vf_weaving_production_logs', 'vf_fabric_dispatches', 'vf_fabric_cut_relations',
          'vf_fabric_designs', 'vf_employees', 'vf_attendance_records', 'vf_employee_loans', 'vf_salary_settlements',
          'vf_costing_products', 'vf_rm_qualities', 'vf_fp_qualities', 'vf_rm_suppliers', 'vf_machinery_assets', 'vf_companies'
        ];

        for (const t of tables) {
          try {
            backup.supabase_relational[t] = await fetchAllRows(t, '*');
          } catch(e) {
            backup.supabase_relational[t] = [];
          }
        }
      }

      // 3. Trigger Browser Download
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2));
      const downloadAnchor = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `vishwa_fashions_full_backup_${timestamp}.json`);
      if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(downloadAnchor);
      }
      if (typeof downloadAnchor.click === 'function') {
        downloadAnchor.click();
      }
      if (typeof downloadAnchor.remove === 'function') {
        downloadAnchor.remove();
      }

      return { success: true, timestamp: timestamp, data: backup };
    },

    // --- 1-Click Non-Destructive LocalStorage to Supabase Migration Engine ---
    async migrateAllToRelational(onProgress = () => {}) {
      if (!this.isConfigured()) return { success: false, error: 'Supabase unconfigured' };
      const summary = {};

      const report = (stage, pct, details) => {
        try { onProgress({ stage, percentage: pct, details }); } catch(e) {}
      };

      report('Starting Non-Destructive Migration...', 5, 'Auditing legacy stores');

      // 1. Migrate Yarn RM Stock Lots & Boxes
      try {
        const rawStock = cache['vishwa_yarn_rm_stock_data'] || nativeLocalStorage.getItem('vishwa_yarn_rm_stock_data');
        if (rawStock) {
          const lots = JSON.parse(rawStock);
          if (Array.isArray(lots) && lots.length > 0) {
            report('Migrating Yarn RM Stock Lots...', 15, `${lots.length} lots found`);
            for (const lot of lots) {
              await VF_DB.yarn.saveLot(lot);
            }
            summary.yarn_lots = lots.length;
          }
        }
      } catch(e) { console.warn('Migration yarn lots notice:', e); }

      // 2. Migrate Yarn Purchase Orders
      try {
        const rawOrders = cache['yarn-orders'] || cache['yarn-rm-orders'] || nativeLocalStorage.getItem('yarn-orders') || nativeLocalStorage.getItem('yarn-rm-orders');
        if (rawOrders) {
          const orders = JSON.parse(rawOrders);
          if (Array.isArray(orders) && orders.length > 0) {
            report('Migrating Yarn Orders...', 25, `${orders.length} orders found`);
            for (const ord of orders) {
              await VF_DB.yarn.saveOrder(ord);
            }
            summary.yarn_orders = orders.length;
          }
        }
      } catch(e) { console.warn('Migration yarn orders notice:', e); }

      // 3. Migrate Yarn Production Logs
      try {
        for (const div of ['covering', 'tfo', 'doubler']) {
          const key = `yarn_${div}_production_logs`;
          const raw = cache[key] || nativeLocalStorage.getItem(key);
          if (raw) {
            const logs = JSON.parse(raw);
            if (Array.isArray(logs) && logs.length > 0) {
              report(`Migrating Yarn Production (${div})...`, 35, `${logs.length} logs`);
              for (const l of logs) {
                await VF_DB.yarn.saveProduction(div, l);
              }
              summary[`yarn_prod_${div}`] = logs.length;
            }
          }
        }
      } catch(e) { console.warn('Migration yarn prod notice:', e); }

      // 4. Migrate Yarn Sales Logs
      try {
        for (const div of ['covering', 'tfo', 'doubler']) {
          const key = `yarn_${div}_sales_logs`;
          const raw = cache[key] || nativeLocalStorage.getItem(key);
          if (raw) {
            const sales = JSON.parse(raw);
            if (Array.isArray(sales) && sales.length > 0) {
              report(`Migrating Yarn Sales (${div})...`, 45, `${sales.length} invoices`);
              for (const s of sales) {
                await VF_DB.yarn.saveSale(div, s);
              }
              summary[`yarn_sales_${div}`] = sales.length;
            }
          }
        }
      } catch(e) { console.warn('Migration yarn sales notice:', e); }

      // 5. Migrate Warp Beams & Loadings
      try {
        const rawBeams = cache['warp-beams'] || nativeLocalStorage.getItem('warp-beams');
        if (rawBeams) {
          const beams = JSON.parse(rawBeams);
          if (Array.isArray(beams) && beams.length > 0) {
            report('Migrating Warp Beams...', 55, `${beams.length} beams`);
            for (const b of beams) {
              await VF_DB.weaving.saveBeam(b);
            }
            summary.warp_beams = beams.length;
          }
        }

        const rawLoadings = cache['warp-beam-loadings'] || nativeLocalStorage.getItem('warp-beam-loadings');
        if (rawLoadings) {
          const loadings = JSON.parse(rawLoadings);
          if (Array.isArray(loadings) && loadings.length > 0) {
            for (const ld of loadings) {
              await VF_DB.weaving.saveBeamLoading(ld);
            }
            summary.warp_loadings = loadings.length;
          }
        }
      } catch(e) { console.warn('Migration warp beams notice:', e); }

      // 6. Migrate Weaving Production Logs & Takas
      try {
        const rawLogs = cache['productionLogs'] || cache['production-logs'] || nativeLocalStorage.getItem('productionLogs') || nativeLocalStorage.getItem('production-logs');
        if (rawLogs) {
          const logs = JSON.parse(rawLogs);
          if (Array.isArray(logs) && logs.length > 0) {
            report('Migrating Weaving Production Logs...', 65, `${logs.length} shift logs`);
            for (const l of logs) {
              await VF_DB.weaving.saveProductionLog(l);
            }
            summary.weaving_production = logs.length;
          }
        }
      } catch(e) { console.warn('Migration weaving logs notice:', e); }

      // 7. Migrate Dispatches & Cut Relations
      try {
        const rawDisp = cache['takaDispatchStates'] || nativeLocalStorage.getItem('takaDispatchStates');
        if (rawDisp) {
          const disps = JSON.parse(rawDisp);
          if (typeof disps === 'object' && disps !== null) {
            const dispList = Array.isArray(disps) ? disps : Object.entries(disps).map(([serial, st]) => ({
              takaSerial: serial,
              status: typeof st === 'string' ? st : (st.status || 'Warehouse'),
              currentStage: typeof st === 'object' ? (st.currentStage || st.stage) : 'Warehouse',
              dispatchDate: typeof st === 'object' ? st.dispatchDate : null,
              vendor: typeof st === 'object' ? st.vendor : null,
              customer: typeof st === 'object' ? st.customer : null
            }));
            for (const d of dispList) {
              await VF_DB.weaving.saveDispatch(d);
            }
            summary.dispatches = dispList.length;
          }
        }

        const rawCuts = cache['takaCutRelations'] || nativeLocalStorage.getItem('takaCutRelations');
        if (rawCuts) {
          const cuts = JSON.parse(rawCuts);
          if (typeof cuts === 'object' && cuts !== null) {
            const cutList = Array.isArray(cuts) ? cuts : Object.entries(cuts).map(([p, ch]) => ({ parentSerial: p, children: ch }));
            for (const c of cutList) {
              await VF_DB.weaving.saveCutRelation(c);
            }
            summary.cut_relations = cutList.length;
          }
        }
      } catch(e) { console.warn('Migration dispatches notice:', e); }

      // 8. Migrate Staff & HR (from aethertasks_db_state_v7)
      try {
        const rawState = cache['aethertasks_db_state_v7'] || nativeLocalStorage.getItem('aethertasks_db_state_v7');
        if (rawState) {
          const st = JSON.parse(rawState);
          if (st.employees && Array.isArray(st.employees)) {
            report('Migrating Employees...', 75, `${st.employees.length} staff`);
            for (const emp of st.employees) {
              await VF_DB.staff.saveEmployee(emp);
            }
            summary.employees = st.employees.length;
          }
          if (st.loans && Array.isArray(st.loans)) {
            for (const l of st.loans) {
              await VF_DB.staff.saveLoan(l);
            }
            summary.loans = st.loans.length;
          }
          if (st.logs && Array.isArray(st.logs)) {
            for (const lg of st.logs) {
              await VF_DB.staff.saveSalarySettlement(lg);
            }
            summary.settlements = st.logs.length;
          }
        }
      } catch(e) { console.warn('Migration staff notice:', e); }

      // 9. Migrate Qualities, Suppliers & Machinery Masters
      try {
        const rawQ = cache['yarn-qualities'] || nativeLocalStorage.getItem('yarn-qualities');
        if (rawQ) {
          const qList = JSON.parse(rawQ);
          if (Array.isArray(qList)) {
            for (const q of qList) await VF_DB.yarn.saveQuality(q);
            summary.qualities = qList.length;
          }
        }

        const rawSupp = cache['yarn-suppliers'] || nativeLocalStorage.getItem('yarn-suppliers');
        if (rawSupp) {
          const sList = JSON.parse(rawSupp);
          if (Array.isArray(sList)) {
            for (const s of sList) await VF_DB.yarn.saveSupplier(s);
            summary.suppliers = sList.length;
          }
        }

        const rawMach = cache['machines'] || nativeLocalStorage.getItem('machines');
        if (rawMach) {
          const mList = JSON.parse(rawMach);
          if (Array.isArray(mList)) {
            for (const m of mList) {
              const name = typeof m === 'string' ? m : (m.name || m.code);
              await VF_DB.weaving.saveMachinery({ name: name, assetType: 'machine' });
            }
            summary.machines = mList.length;
          }
        }
      } catch(e) { console.warn('Migration masters notice:', e); }

      report('Migration Completed Successfully!', 100, summary);
      return { success: true, summary: summary };
    },
    mergeYarnSalesDatasets: mergeYarnSalesDatasets,
    mergeYarnProductionDatasets: mergeYarnProductionDatasets,
    mergeYarnLedgerDatasets: mergeYarnLedgerDatasets,
    mergeYarnStockDatasets: mergeYarnStockDatasets,
    mergeYarnOrdersDatasets: mergeYarnOrdersDatasets,
    mergeDatasets: mergeDatasets
  };

  // Expose VF_DB globally
  window.VF_DB = VF_DB;
  supabaseApi.db = VF_DB;

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

