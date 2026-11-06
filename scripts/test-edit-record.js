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
      nowISO() { return '2026-11-06T00:00:00.000Z'; },
      parsePositiveInt(value) { return value === '' ? null : Number(value); },
      formatDate() { return '2026-11-06 00:00'; },
      generateId() { return 'generated-id'; },
      prepareFeedback() {},
      vibrate() {}
    },
    DataStore: {
      meta() { return { loaded: true }; },
      find() { return null; }
    },
    DB: {
      async getRecord(id) { return context.__records[id]; },
      async upsert(record) {
        context.__upserted = record;
        context.__records[record.id] = record;
        return record;
      }
    },
    Scanner: { async start() {}, async stop() {} }
  };

  vm.createContext(context);
  const appPath = path.join(__dirname, '..', 'js', 'app.js');
  const source = fs.readFileSync(appPath, 'utf8') + '\nglobalThis.App = App;';
  vm.runInContext(source, context, { filename: appPath });

  context.App.showToast = () => {};
  context.App.refreshRecordList = async () => {};
  context.App.showPage = (pageId) => { context.__page = pageId; };

  // 场景 1：编辑一条"已出库(异常)"记录，保存后判定与原始状态不得被改写
  context.__records = {
    'rec-1': {
      id: 'rec-1',
      sessionId: 'session-1',
      pallet: '104189032607310005',
      rawText: '104189032607310005',
      invoice: 'INV-1',
      part: 'PART-1',
      qty: 176,
      status: '已出库',
      result: 'abnormal',
      resultLabel: '异常',
      sourceMatched: true,
      location: '',
      remark: '',
      scannedAt: '2026-11-05T13:39:00.000Z',
      updatedAt: '2026-11-05T13:39:00.000Z',
      entryMode: 'scan'
    }
  };
  context.App._editingId = 'rec-1';
  // 表单里按现状 UI 会显示判定词，刻意填入以验证它不会被写回
  document.getElementById('edit-status').value = '异常';
  document.getElementById('edit-invoice').value = 'INV-1';
  document.getElementById('edit-part').value = 'PART-1-FIXED';
  document.getElementById('edit-qty').value = '176';
  document.getElementById('edit-location').value = 'M1069';
  document.getElementById('edit-remark').value = '补录库位';
  await context.App._saveEditedRecord();

  assert.strictEqual(context.__upserted.status, '已出库', '原始状态必须保留');
  assert.strictEqual(context.__upserted.result, 'abnormal', '异常判定必须保留');
  assert.strictEqual(context.__upserted.resultLabel, '异常');
  assert.strictEqual(context.__upserted.sourceMatched, true);
  assert.strictEqual(context.__upserted.pallet, '104189032607310005');
  assert.strictEqual(context.__upserted.scannedAt, '2026-11-05T13:39:00.000Z');
  assert.strictEqual(context.__upserted.part, 'PART-1-FIXED');
  assert.strictEqual(context.__upserted.location, 'M1069');
  assert.strictEqual(context.__upserted.remark, '补录库位');
  assert.strictEqual(context.__upserted.updatedAt, '2026-11-06T00:00:00.000Z');
  assert.strictEqual(context.App._editingId, null);
  assert.strictEqual(context.__page, 'page-session');

  // 场景 2：未命中基础数据的记录，其 status 文案同样不得被判定词覆盖
  context.__records = {
    'rec-2': {
      id: 'rec-2',
      sessionId: 'session-1',
      pallet: '999999999999999999',
      rawText: '999999999999999999',
      invoice: '',
      part: '',
      qty: '',
      status: '未命中基础数据',
      result: 'normal',
      resultLabel: '正常',
      sourceMatched: false,
      location: '',
      remark: '',
      scannedAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
      entryMode: 'scan'
    }
  };
  context.App._editingId = 'rec-2';
  document.getElementById('edit-status').value = '未命中';
  document.getElementById('edit-invoice').value = '';
  document.getElementById('edit-part').value = '';
  document.getElementById('edit-qty').value = '3';
  document.getElementById('edit-location').value = 'A-01';
  document.getElementById('edit-remark').value = '';
  await context.App._saveEditedRecord();

  assert.strictEqual(context.__upserted.status, '未命中基础数据');
  assert.strictEqual(context.__upserted.sourceMatched, false);
  assert.strictEqual(context.__upserted.qty, 3);

  console.log('edit record preservation checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
