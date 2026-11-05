'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement(initialValue = '') {
  return {
    value: initialValue,
    textContent: '',
    innerHTML: '',
    className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    focus() {},
    scrollIntoView() {}
  };
}

function createDocument() {
  const elements = new Map();
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return createElement(); },
    addEventListener() {},
    _elements: elements
  };
}

(async () => {
  const document = createDocument();
  const toasts = [];
  const context = {
    console,
    document,
    window: { addEventListener() {}, scrollTo() {} },
    navigator: { serviceWorker: { register() { return Promise.resolve(); } } },
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) { callback(); },
    Utils: {
      esc(value) { return String(value == null ? '' : value); },
      nowISO() { return '2026-06-10T00:00:00.000Z'; },
      parsePositiveInt(value) { return value === '' ? null : Number(value); },
      formatDate() { return '2026-06-10 00:00'; },
      generateId() { return 'generated-id'; },
      prepareFeedback() {},
      vibrate() {}
    },
    DataStore: {
      meta() { return { loaded: true }; },
      find(pallet) {
        if (pallet === '123456789012345678') {
          return { invoice: 'INV-1', part: 'PART-1', qty: 5, status: '已出库', statusKind: 'outbound' };
        }
        return null;
      }
    },
    DB: {
      async getRecordsBySession() { return []; },
      async upsert(record) {
        context.__upserted = record;
        return record;
      }
    },
    Scanner: { async start() {}, async stop() {} }
  };

  vm.createContext(context);
  const appPath = path.join(__dirname, '..', 'js', 'app.js');
  const source = fs.readFileSync(appPath, 'utf8') + '\nglobalThis.App = App;';
  vm.runInContext(source, context, { filename: appPath });

  context.App.showToast = (message, isError) => {
    toasts.push({ message, isError });
  };
  context.App.refreshRecordList = async () => {
    context.__refreshed = true;
  };
  context.App.showPage = (pageId) => {
    context.__page = pageId;
  };
  context.App._renderRecentScans = async () => {
    context.__recentRendered = true;
  };
  context.App._renderScanForm = (record, mode) => {
    context.__rendered = { record, mode };
  };

  assert.strictEqual(context.App._normalizeManualPallet(' 123456789012345678 '), '123456789012345678');
  assert.strictEqual(context.App._normalizeManualPallet(' JY-ABC-001 '), 'JY-ABC-001');
  assert.strictEqual(context.App._normalizeManualPallet('   '), null);

  document.getElementById('input-manual-pallet').value = '123456789012345678';
  await context.App._createManualRecord();

  assert.strictEqual(context.__recentRendered, true);
  assert.strictEqual(context.__page, 'page-scanner');
  assert.strictEqual(context.__rendered.mode, 'manual');
  assert.strictEqual(context.__rendered.record.pallet, '123456789012345678');
  assert.strictEqual(context.__rendered.record.invoice, 'INV-1');
  assert.strictEqual(context.__rendered.record.result, 'abnormal');
  assert.strictEqual(context.__rendered.record.entryMode, 'manual');
  assert.strictEqual(context.App._pendingRecordSource, 'manual');

  document.getElementById('input-manual-pallet').value = 'bad';
  await context.App._createManualRecord();
  assert.strictEqual(context.__rendered.record.pallet, 'bad');
  assert.strictEqual(context.__rendered.record.sourceMatched, false);
  assert.strictEqual(context.__rendered.record.entryMode, 'manual');

  document.getElementById('input-manual-pallet').value = '   ';
  await context.App._createManualRecord();
  assert.strictEqual(toasts.at(-1).message, '请输入托盘号');

  context.App._pendingRecord = { id: 'record-1', sessionId: 'session-1', pallet: 'JY-ABC-001', invoice: '', part: '', qty: '', status: '', location: '', remark: '', sourceMatched: false, entryMode: 'manual', scannedAt: '2026-06-10T00:00:00.000Z' };
  context.App._pendingDuplicateRecord = null;
  context.App._pendingRecordSource = 'manual';
  document.getElementById('scan-pallet').value = 'JY-ABC-001';
  document.getElementById('scan-invoice').value = 'INV-X';
  document.getElementById('scan-part').value = 'PART-X';
  document.getElementById('scan-qty').value = '7';
  document.getElementById('scan-status').value = '未到库';
  document.getElementById('scan-location').value = 'A-01';
  document.getElementById('scan-remark').value = 'manual';
  await context.App._saveScanRecord();
  assert.strictEqual(context.__upserted.pallet, 'JY-ABC-001');
  assert.strictEqual(context.__upserted.invoice, 'INV-X');
  assert.strictEqual(context.__upserted.location, 'A-01');
  assert.strictEqual(context.__page, 'page-session');
  assert.strictEqual(context.__refreshed, true);

  console.log('manual record helpers checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
