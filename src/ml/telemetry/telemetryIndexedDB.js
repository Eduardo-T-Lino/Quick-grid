// ========== TELEMETRY INDEXEDDB OFFLINE STORE (FASE ML2.1) ==========
// Persistência local robusta de batches selados pendentes de ACK (sobrevive a reload/queda de internet)

const DB_NAME = 'QuickGridTelemetryDB';
const DB_VERSION = 2;
const STORE_NAME = 'pending_batches';
const SESSION_STORE_NAME = 'session_credentials';

class TelemetryIndexedDB {
  constructor() {
    this._db = null;
    this._opening = null;
    this._epoch = 0;
    this._memoryFallback = new Map(); // Fallback transparente em ambientes sem IndexedDB (ex: Node/testes)
    this._memoryCredentials = new Map();
  }

  isSupported() {
    return typeof window !== 'undefined' && Boolean(window.indexedDB);
  }

  async getDB() {
    if (!this.isSupported()) return null;
    if (this._db) return this._db;
    if (this._opening) return this._opening;

    this._opening = new Promise((resolve) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'batchKey' });
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
          db.createObjectStore(SESSION_STORE_NAME, { keyPath: 'serverSessionId' });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        this._db.onversionchange = () => { this._db.close(); this._db = null; };
        resolve(this._db);
      };

      request.onerror = (event) => {
        console.warn('[ML-INDEXEDDB] Erro ao abrir IndexedDB:', event.target.error);
        resolve(null);
      };
    }).finally(() => { this._opening = null; });
    return this._opening;
  }

  /**
   * Salva um batch selado pendente de confirmação
   */
  async saveBatch(batch) {
    const epoch = this._epoch;
    const batchKey = `${batch.sessionId}:${batch.batchSequence}`;
    const record = {
      batchKey,
      sessionId: batch.sessionId,
      batchSequence: batch.batchSequence,
      samples: batch.samples,
      createdAt: batch.createdAt || Date.now(),
      retryCount: batch.retryCount || 0
    };

    if (!this.isSupported()) {
      this._memoryFallback.set(batchKey, record);
      return record;
    }

    const db = await this.getDB();
    if (epoch !== this._epoch) return null;
    if (!db) {
      this._memoryFallback.set(batchKey, record);
      return record;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(record);
        tx.oncomplete = () => resolve(record);
        tx.onerror = () => {
          if (epoch === this._epoch) this._memoryFallback.set(batchKey, record);
          resolve(record);
        };
      } catch {
        this._memoryFallback.set(batchKey, record);
        resolve(record);
      }
    });
  }

  /**
   * Carrega todos os batches pendentes ordenados por sequência e tempo
   */
  async getAllPendingBatches() {
    if (!this.isSupported()) {
      return Array.from(this._memoryFallback.values()).sort((a, b) => a.batchSequence - b.batchSequence);
    }

    const db = await this.getDB();
    if (!db) {
      return Array.from(this._memoryFallback.values()).sort((a, b) => a.batchSequence - b.batchSequence);
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const items = (req.result || []).sort((a, b) => a.batchSequence - b.batchSequence);
          resolve(items);
        };
        req.onerror = () => {
          resolve(Array.from(this._memoryFallback.values()));
        };
      } catch {
        resolve(Array.from(this._memoryFallback.values()));
      }
    });
  }

  /**
   * Remove o batch confirmado (ACK)
   */
  async removeBatch(sessionId, batchSequence) {
    const batchKey = `${sessionId}:${batchSequence}`;
    this._memoryFallback.delete(batchKey);

    if (!this.isSupported()) return true;

    const db = await this.getDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(batchKey);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch {
        resolve(true);
      }
    });
  }

  /**
   * Remove todos os batches armazenados
   */
  async clearAll() {
    this._epoch++;
    this._memoryFallback.clear();
    this._memoryCredentials.clear();
    if (!this.isSupported()) return true;

    const db = await this.getDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_NAME, SESSION_STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(SESSION_STORE_NAME).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch {
        resolve(true);
      }
    });
  }

  async saveSessionCredentials(session) {
    if (!session?.serverSessionId) return null;
    const epoch = this._epoch;
    session = structuredClone(session);
    this._memoryCredentials.set(session.serverSessionId, session);
    if (!this.isSupported()) return session;
    const db = await this.getDB();
    if (epoch !== this._epoch) return null;
    if (!db) return session;
    return new Promise(resolve => {
      const tx = db.transaction([SESSION_STORE_NAME], 'readwrite');
      tx.objectStore(SESSION_STORE_NAME).put(session);
      tx.oncomplete = () => resolve(session);
      tx.onerror = () => resolve(session);
    });
  }

  async getSessionCredentials(serverSessionId) {
    if (!serverSessionId) return null;
    if (!this.isSupported()) return this._memoryCredentials.get(serverSessionId) || null;
    const db = await this.getDB();
    if (!db) return null;
    return new Promise(resolve => {
      const tx = db.transaction([SESSION_STORE_NAME], 'readonly');
      const req = tx.objectStore(SESSION_STORE_NAME).get(serverSessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async getAllSessionCredentials() {
    if (!this.isSupported()) return [...this._memoryCredentials.values()];
    const db = await this.getDB();
    if (!db) return [];
    return new Promise(resolve => {
      const req = db.transaction([SESSION_STORE_NAME], 'readonly').objectStore(SESSION_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async removeSessionCredentials(serverSessionId) {
    this._memoryCredentials.delete(serverSessionId);
    if (!this.isSupported()) return true;
    const db = await this.getDB();
    if (!db) return true;
    return new Promise(resolve => {
      const tx = db.transaction([SESSION_STORE_NAME], 'readwrite');
      tx.objectStore(SESSION_STORE_NAME).delete(serverSessionId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  /**
   * Retorna a quantidade de batches atualmente pendentes no IndexedDB
   */
  async getCount() {
    if (!this.isSupported()) return this._memoryFallback.size;

    const db = await this.getDB();
    if (!db) return this._memoryFallback.size;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(this._memoryFallback.size);
      } catch {
        resolve(this._memoryFallback.size);
      }
    });
  }
}

export const telemetryIndexedDB = new TelemetryIndexedDB();
