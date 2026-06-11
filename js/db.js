'use strict';

const DB = {
  DB_NAME: 'StockSitReviewDB',
  DB_VERSION: 4,
  _db: null,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('records')) {
          const recordStore = db.createObjectStore('records', { keyPath: 'id' });
          recordStore.createIndex('sessionId', 'sessionId');
          recordStore.createIndex('pallet', 'pallet');
          recordStore.createIndex('scannedAt', 'scannedAt');
        } else {
          const recordStore = event.target.transaction.objectStore('records');
          if (!recordStore.indexNames.contains('sessionId')) recordStore.createIndex('sessionId', 'sessionId');
          if (!recordStore.indexNames.contains('pallet')) recordStore.createIndex('pallet', 'pallet');
          if (!recordStore.indexNames.contains('scannedAt')) recordStore.createIndex('scannedAt', 'scannedAt');
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => reject(event.target.error);
    });
  },

  async createSession(name) {
    await this.open();
    const session = {
      id: Utils.generateId(),
      name,
      createdAt: Utils.nowISO(),
      recordCount: 0
    };
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').add(session);
      tx.oncomplete = () => resolve(session);
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async getAllSessions() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('sessions');
      const request = tx.objectStore('sessions').getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async getSession(id) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('sessions');
      const request = tx.objectStore('sessions').get(id);
      request.onsuccess = () => resolve(request.result || null);
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async deleteSession(id) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(['sessions', 'records'], 'readwrite');
      tx.objectStore('sessions').delete(id);
      const index = tx.objectStore('records').index('sessionId');
      const cursorRequest = index.openCursor(id);
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async getAllRecords() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('records');
      const request = tx.objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt)));
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async getRecordsBySession(sessionId) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('records');
      const request = tx.objectStore('records').index('sessionId').getAll(sessionId);
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt)));
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async getRecord(id) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('records');
      const request = tx.objectStore('records').get(id);
      request.onsuccess = () => resolve(request.result || null);
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async findByPallet(pallet) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('records');
      const request = tx.objectStore('records').index('pallet').get(pallet);
      request.onsuccess = () => resolve(request.result || null);
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async upsert(record) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(['records', 'sessions'], 'readwrite');
      const recordStore = tx.objectStore('records');
      const sessionStore = tx.objectStore('sessions');
      const existingRequest = recordStore.get(record.id);
      existingRequest.onsuccess = () => {
        const existed = Boolean(existingRequest.result);
        recordStore.put(record);
        if (!existed) {
          const sessionRequest = sessionStore.get(record.sessionId);
          sessionRequest.onsuccess = () => {
            const session = sessionRequest.result;
            if (!session) return;
            sessionStore.put(Object.assign({}, session, { recordCount: (session.recordCount || 0) + 1 }));
          };
        }
      };
      tx.oncomplete = () => resolve(record);
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async delete(id) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(['records', 'sessions'], 'readwrite');
      const recordStore = tx.objectStore('records');
      const sessionStore = tx.objectStore('sessions');
      const request = recordStore.get(id);
      request.onsuccess = () => {
        const record = request.result;
        if (!record) return;
        recordStore.delete(id);
        const sessionRequest = sessionStore.get(record.sessionId);
        sessionRequest.onsuccess = () => {
          const session = sessionRequest.result;
          if (!session) return;
          sessionStore.put(Object.assign({}, session, { recordCount: Math.max(0, (session.recordCount || 0) - 1) }));
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = (event) => reject(event.target.error);
    });
  }
};
