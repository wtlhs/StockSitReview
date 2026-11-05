'use strict';

const App = {
  VERSION: '20261105-01',
  currentSessionId: null,
  _toastTimer: null,
  _pendingRecord: null,
  _pendingDuplicateRecord: null,
  _pendingRecordSource: 'scan',
  _editingId: null,

  async init() {
    document.getElementById('footer-version').textContent = 'v' + this.VERSION;
    this._bindEvents();
    await DB.open();
    await this._loadBasicData();
    await this.refreshSessionList();
    this._registerServiceWorker();
  },

  showPage(pageId) {
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
  },

  showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast' + (isError ? ' error' : '');
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  },

  _scrollScannerToTop() {
    const page = document.getElementById('page-scanner');
    const container = document.getElementById('scanner-container');
    if (page) {
      page.scrollTop = 0;
      if (typeof page.scrollTo === 'function') {
        page.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    }
    if (container) container.scrollIntoView({ block: 'start', behavior: 'auto' });
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  },

  async _loadBasicData() {
    this._setDataStatus('loading', '正在加载基础数据', '请稍候，正在读取 docs/basic-data.json');
    try {
      const data = await DataStore.load();
      const outbound = data.statusCounts && data.statusCounts['已出库'] ? data.statusCounts['已出库'] : 0;
      this._setDataStatus('ready', '基础数据已加载', '来源：' + data.source + '；托盘：' + data.count + '；已出库：' + outbound);
    } catch (error) {
      this._setDataStatus('error', '基础数据加载失败', error.message || '请先生成 docs/basic-data.json');
      this.showToast('基础数据加载失败', true);
    }
  },

  _setDataStatus(kind, title, detail) {
    const card = document.getElementById('data-status-card');
    card.className = 'data-status-card status-' + kind;
    document.getElementById('data-status-title').textContent = title;
    document.getElementById('data-status-detail').textContent = detail;
  },

  async refreshSessionList() {
    const sessions = await DB.getAllSessions();
    const container = document.getElementById('session-list');
    const desc = document.getElementById('stock-module-desc');
    desc.textContent = sessions.length + ' 个盘点会话';

    if (!sessions.length) {
      container.innerHTML = '<div class="empty-mini">暂无盘点会话</div>';
      return;
    }

    container.innerHTML = '<div class="session-list-scroll">' + sessions.map((session) => (
      '<div class="session-card" data-id="' + session.id + '">' +
        '<div class="session-info">' +
          '<div class="session-name">' + Utils.esc(session.name) + '</div>' +
          '<div class="session-meta">' + Utils.formatDate(session.createdAt) + '</div>' +
        '</div>' +
        '<div class="session-count">' + (session.recordCount || 0) + ' 条</div>' +
        '<div class="session-actions"><button class="btn btn-sm btn-secondary btn-delete-session" data-id="' + session.id + '" type="button">删除</button></div>' +
      '</div>'
    )).join('') + '</div>';

    container.querySelectorAll('.session-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        if (event.target.classList.contains('btn-delete-session')) {
          event.stopPropagation();
          this._confirmDeleteSession(card.dataset.id);
          return;
        }
        this.openSession(card.dataset.id);
      });
    });
  },

  async openSession(sessionId) {
    const session = await DB.getSession(sessionId);
    if (!session) {
      this.showToast('会话不存在', true);
      await this.refreshSessionList();
      this.showPage('page-home');
      return;
    }
    this.currentSessionId = sessionId;
    document.getElementById('session-title').textContent = session.name;
    await this.refreshRecordList();
    this.showPage('page-session');
  },

  async refreshRecordList() {
    const records = await DB.getRecordsBySession(this.currentSessionId);
    const total = records.length;
    const abnormal = records.filter((record) => record.result === 'abnormal').length;
    const missing = records.filter((record) => !record.sourceMatched).length;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-abnormal').textContent = abnormal;
    document.getElementById('stat-missing').textContent = missing;
    document.getElementById('record-count').textContent = '共 ' + total + ' 条记录';
    this._renderRecordList(records);
  },

  _renderRecordList(records) {
    const container = document.getElementById('record-list');
    if (!records.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">□</div><p>还没有扫码记录<br>点击下方按钮开始扫码</p></div>';
      return;
    }

    container.innerHTML = records.map((record, index) => {
      const statusClass = record.result === 'abnormal' ? 'status-outbound' : record.sourceMatched ? 'status-stocked' : 'status-missing';
      const label = record.result === 'abnormal' ? '异常' : record.sourceMatched ? '正常' : '未命中';
      return '<div class="record-card" data-id="' + record.id + '">' +
        '<div class="record-index">' + (index + 1) + '</div>' +
        '<div class="record-body">' +
          '<div class="record-title">' + Utils.esc(record.pallet) + ' <span class="status-badge ' + statusClass + '">' + label + '</span></div>' +
          '<div class="record-subtitle">零件: ' + Utils.esc(record.part || '-') + ' | 数量: ' + Utils.esc(record.qty !== '' ? record.qty : '-') + ' | 状态: ' + Utils.esc(record.status || '-') + '</div>' +
          '<div class="record-subtitle">库位: <strong>' + Utils.esc(record.location || '-') + '</strong>' + (record.remark ? ' | 备注: ' + Utils.esc(record.remark) : '') + '</div>' +
        '</div>' +
        '<div class="record-actions">' +
          '<button class="btn-icon btn-edit-record" data-id="' + record.id + '" type="button">编辑</button>' +
          '<button class="btn-icon danger btn-delete-record" data-id="' + record.id + '" type="button">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');

    container.querySelectorAll('.btn-edit-record').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this._editRecord(button.dataset.id);
      });
    });
    container.querySelectorAll('.btn-delete-record').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this._confirmDeleteRecord(button.dataset.id);
      });
    });
  },

  async openManualRecord() {
    if (!this.currentSessionId) {
      this.showToast('请先进入盘点会话', true);
      return;
    }
    if (!DataStore.meta()) {
      this.showToast('基础数据未加载完成', true);
      return;
    }
    document.getElementById('input-manual-pallet').value = '';
    document.getElementById('modal-manual-record').classList.add('active');
    setTimeout(() => document.getElementById('input-manual-pallet').focus(), 50);
  },

  _normalizeManualPallet(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, '').trim();
    return normalized || null;
  },

  async _openManualRecordForm(record) {
    await Scanner.stop();
    this.showPage('page-scanner');
    await this._renderRecentScans();
    this._scrollScannerToTop();
    this._renderScanForm(record, 'manual');
    requestAnimationFrame(() => this._scrollScannerToTop());
  },

  async _createManualRecord() {
    const rawInput = document.getElementById('input-manual-pallet').value;
    const pallet = this._normalizeManualPallet(rawInput);
    if (!pallet) {
      this.showToast('请输入托盘号', true);
      return;
    }
    document.getElementById('modal-manual-record').classList.remove('active');
    const existing = await this._findCurrentSessionRecordByPallet(pallet);
    const record = this._buildRecord(pallet, pallet, existing, 'manual');
    this._pendingRecord = record;
    this._pendingRecordSource = 'manual';
    this._pendingDuplicateRecord = existing || null;
    if (existing) {
      document.getElementById('manual-duplicate-message').textContent = '当前盘点会话内已存在托盘号「' + pallet + '」的记录，是否覆盖为本次手动创建内容？';
      document.getElementById('modal-manual-duplicate').classList.add('active');
      return;
    }
    await this._openManualRecordForm(record);
  },

  async _findCurrentSessionRecordByPallet(pallet) {
    const records = await DB.getRecordsBySession(this.currentSessionId);
    return records.find((record) => record.pallet === pallet) || null;
  },

  _setScannerPageTitle(mode) {
    const title = document.getElementById('scanner-page-title');
    if (!title) return;
    title.textContent = mode === 'manual' ? '手动创建记录' : '扫码盘点';
  },

  _manualEntryHintHtml() {
    return '<div class="scan-result"><div class="field-grid">' +
      '<div class="field full-width"><div class="field-label">创建方式</div><div class="field-value">手动创建盘点记录</div></div>' +
      '<div class="field full-width"><div class="field-label">规则</div><div class="field-value">请输入任意托盘号；未命中基础数据时也可手动补充后保存</div></div>' +
    '</div></div>';
  },

  async openScanner() {
    if (!DataStore.meta()) {
      this.showToast('基础数据未加载完成', true);
      return;
    }
    this._pendingRecordSource = 'scan';
    this._setScannerPageTitle('scan');
    this.showPage('page-scanner');
    Utils.prepareFeedback();
    document.getElementById('scan-result-area').innerHTML = this._idleScanHtml();
    await this._renderRecentScans();
    this._scrollScannerToTop();
    Utils.prepareFeedback();
    await Scanner.start('scanner-container', (pallet, rawText) => this._handleScannedPallet(pallet, rawText));
    requestAnimationFrame(() => this._scrollScannerToTop());
    setTimeout(() => this._scrollScannerToTop(), 0);
  },

  _idleScanHtml() {
    return '<div class="scan-result"><div class="field-grid">' +
      '<div class="field full-width"><div class="field-label">扫描位置</div><div class="field-value">Handling Unit Number 区域的条形码</div></div>' +
      '<div class="field full-width"><div class="field-label">规则</div><div class="field-value">18 位数字托盘号；扫错位置会提示继续扫描</div></div>' +
    '</div></div>';
  },

  async _handleScannedPallet(pallet, rawText) {
    const existing = await this._findCurrentSessionRecordByPallet(pallet);
    const record = this._buildRecord(pallet, rawText, existing, 'scan');
    this._pendingRecord = record;
    this._pendingRecordSource = 'scan';
    this._pendingDuplicateRecord = existing || null;
    if (existing) {
      document.getElementById('duplicate-message').textContent = '托盘号「' + pallet + '」已有记录，覆盖后将保留本次扫码匹配结果并更新库位、备注。';
      document.getElementById('modal-duplicate').classList.add('active');
      return;
    }
    this._renderScanForm(record, 'scan');
  },

  _buildRecord(pallet, rawText, existing, entryMode = 'scan') {
    const base = DataStore.find(pallet);
    const now = Utils.nowISO();
    const abnormal = base && base.statusKind === 'outbound';
    return {
      id: existing ? existing.id : Utils.generateId(),
      sessionId: this.currentSessionId,
      pallet,
      rawText,
      invoice: base ? base.invoice : '',
      part: base ? base.part : '',
      qty: base ? base.qty : '',
      status: base ? base.status : '未命中基础数据',
      result: abnormal ? 'abnormal' : 'normal',
      resultLabel: abnormal ? '异常' : '正常',
      location: existing ? existing.location || '' : '',
      remark: existing ? existing.remark || '' : '',
      scannedAt: existing ? existing.scannedAt : now,
      updatedAt: now,
      sourceMatched: Boolean(base),
      entryMode
    };
  },

  _renderScanForm(record, mode = 'scan') {
    const scannerContainer = document.getElementById('scanner-container');
    scannerContainer.classList.add('collapsed');
    this._setScannerPageTitle(mode);
    const palletField = mode === 'manual'
      ? '<div class="form-group"><label for="scan-pallet">托盘号</label><input type="text" id="scan-pallet" autocomplete="off" value="' + Utils.esc(record.pallet || '') + '"></div>'
      : '';
    const introHtml = mode === 'manual' ? this._manualEntryHintHtml() : this._buildScanInfoHtml(record);
    document.getElementById('scan-result-area').innerHTML = introHtml +
      '<form id="scan-form">' +
        palletField +
        '<div class="form-row">' +
          '<div class="form-group"><label for="scan-invoice">发票号</label><input type="text" id="scan-invoice" autocomplete="off" value="' + Utils.esc(record.invoice || '') + '"></div>' +
          '<div class="form-group"><label for="scan-part">零件号</label><input type="text" id="scan-part" autocomplete="off" value="' + Utils.esc(record.part || '') + '"></div>' +
        '</div>' +
        '<div class="form-row">' +
          '<div class="form-group"><label for="scan-qty">数量</label><input type="number" id="scan-qty" inputmode="numeric" value="' + Utils.esc(record.qty !== '' ? record.qty : '') + '"></div>' +
          '<div class="form-group"><label for="scan-status">原始状态</label><input type="text" id="scan-status" autocomplete="off" value="' + Utils.esc(record.status || '') + '"></div>' +
        '</div>' +
        '<div class="form-group"><label for="scan-location">库位号</label><input type="text" id="scan-location" autocomplete="off" placeholder="选填，如 A-03" value="' + Utils.esc(record.location) + '"></div>' +
        '<div class="form-group"><label for="scan-remark">备注</label><textarea id="scan-remark" placeholder="选填备注信息">' + Utils.esc(record.remark) + '</textarea></div>' +
        '<button type="submit" class="btn btn-success btn-block">确认保存</button>' +
        '<button type="button" class="btn btn-secondary btn-block btn-scan-continue" id="btn-scan-cancel">' + (mode === 'manual' ? '取消' : '继续扫码') + '</button>' +
      '</form>';
    document.getElementById('scan-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this._saveScanRecord();
    });
    document.getElementById('btn-scan-cancel').addEventListener('click', () => {
      this._scrollScannerToTop();
      if (mode === 'manual') {
        this.showPage('page-session');
        return;
      }
      this.openScanner();
    });
    const focusTarget = mode === 'manual' ? document.getElementById('scan-pallet') : document.getElementById('scan-location');
    if (focusTarget) focusTarget.focus();
    requestAnimationFrame(() => this._scrollScannerToTop());
    if (mode === 'manual') {
      if (!record.sourceMatched) {
        this.showToast('未命中基础数据，可手动补充后保存');
      } else if (record.result === 'abnormal') {
        this.showToast('该托盘为已出库状态，请核查', true);
      } else {
        this.showToast('已带出基础数据，可继续补充字段');
      }
      return;
    }
    if (record.result === 'abnormal') {
      this.showToast('该托盘为已出库状态，请核查', true);
      Utils.vibrate([220, 120, 220]);
    } else if (!record.sourceMatched) {
      this.showToast('未命中基础数据，请核查', true);
      Utils.vibrate([80, 80, 80]);
    } else {
      this.showToast('托盘状态正常');
      Utils.vibrate(120);
    }
  },

  _buildScanInfoHtml(record) {
    const statusClass = record.result === 'abnormal' ? 'status-outbound' : record.sourceMatched ? 'status-stocked' : 'status-missing';
    const label = record.result === 'abnormal' ? '异常' : record.sourceMatched ? '正常' : '未命中';
    return '<div class="scan-result"><div class="field-grid">' +
      '<div class="field full-width"><div class="field-label">托盘号</div><div class="field-value">' + Utils.esc(record.pallet) + '</div></div>' +
      '<div class="field"><div class="field-label">状态判定</div><div class="field-value"><span class="status-badge ' + statusClass + '">' + label + '</span></div></div>' +
      '<div class="field"><div class="field-label">原始状态</div><div class="field-value">' + Utils.esc(record.status || '-') + '</div></div>' +
      '<div class="field"><div class="field-label">零件号</div><div class="field-value">' + Utils.esc(record.part || '-') + '</div></div>' +
      '<div class="field"><div class="field-label">数量</div><div class="field-value">' + Utils.esc(record.qty !== '' ? record.qty : '-') + '</div></div>' +
      '<div class="field full-width"><div class="field-label">发票号</div><div class="field-value">' + Utils.esc(record.invoice || '-') + '</div></div>' +
    '</div></div>';
  },

  _buildResultFromStatus(status) {
    return status === '已出库'
      ? { result: 'abnormal', resultLabel: '异常' }
      : { result: 'normal', resultLabel: '正常' };
  },

  _readEditableFields(prefix) {
    const status = document.getElementById(prefix + '-status').value.trim();
    const resultInfo = this._buildResultFromStatus(status);
    return Object.assign({}, resultInfo, {
      invoice: document.getElementById(prefix + '-invoice').value.trim(),
      part: document.getElementById(prefix + '-part').value.trim(),
      qty: Utils.parsePositiveInt(document.getElementById(prefix + '-qty').value.trim()),
      status,
      location: document.getElementById(prefix + '-location').value.trim(),
      remark: document.getElementById(prefix + '-remark').value.trim()
    });
  },

  async _saveScanRecord() {
    if (!this._pendingRecord) return;
    const manualPalletInput = document.getElementById('scan-pallet');
    const pallet = manualPalletInput ? this._normalizeManualPallet(manualPalletInput.value) : this._pendingRecord.pallet;
    if (!pallet) {
      this.showToast('请输入托盘号', true);
      if (manualPalletInput) manualPalletInput.focus();
      return;
    }
    const matchedDuplicate = this._pendingDuplicateRecord
      && this._pendingDuplicateRecord.sessionId === this.currentSessionId
      && this._pendingDuplicateRecord.pallet === pallet
      ? this._pendingDuplicateRecord
      : null;
    const baseRecord = this._buildRecord(pallet, pallet, matchedDuplicate, this._pendingRecordSource);
    const record = Object.assign({}, this._pendingRecord, baseRecord, this._readEditableFields('scan'), {
      id: matchedDuplicate ? matchedDuplicate.id : (this._pendingRecord.id || Utils.generateId()),
      scannedAt: matchedDuplicate ? matchedDuplicate.scannedAt : (this._pendingRecord.scannedAt || Utils.nowISO()),
      updatedAt: Utils.nowISO()
    });
    await DB.upsert(record);
    this._pendingRecord = null;
    this._pendingDuplicateRecord = null;
    const entryMode = this._pendingRecordSource;
    this._pendingRecordSource = 'scan';
    this.showToast('保存成功');
    await this._renderRecentScans();
    if (entryMode === 'manual') {
      await this.refreshRecordList();
      this.showPage('page-session');
      return;
    }
    await this.openScanner();
  },

  async _renderRecentScans() {
    if (!this.currentSessionId) return;
    const records = await DB.getRecordsBySession(this.currentSessionId);
    const recent = records.slice(0, 5);
    const container = document.getElementById('recent-scans');
    if (!recent.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = '<div class="records-header"><h2>最近扫码</h2></div>' + recent.map((record) => (
      '<div class="record-card compact"><div class="record-body">' +
        '<div class="record-title">' + Utils.esc(record.pallet) + '</div>' +
        '<div class="record-subtitle">' + Utils.esc(record.part || '-') + ' | 库位: ' + Utils.esc(record.location || '-') + '</div>' +
      '</div></div>'
    )).join('');
  },

  async _editRecord(recordId) {
    const record = await DB.getRecord(recordId);
    if (!record) return;
    this._editingId = recordId;
    document.getElementById('edit-scan-info').innerHTML = this._buildScanInfoHtml(record);
    document.getElementById('edit-pallet').value = record.pallet || '';
    document.getElementById('edit-status').value = record.result === 'abnormal' ? '异常' : record.sourceMatched ? '正常' : '未命中';
    document.getElementById('edit-invoice').value = record.invoice || '';
    document.getElementById('edit-part').value = record.part || '';
    document.getElementById('edit-location').value = record.location || '';
    document.getElementById('edit-qty').value = record.qty != null ? record.qty : '';
    document.getElementById('edit-remark').value = record.remark || '';
    this.showPage('page-edit');
    document.getElementById('edit-location').focus();
  },

  async _saveEditedRecord() {
    const record = await DB.getRecord(this._editingId);
    if (!record) return;
    const updated = Object.assign({}, record, this._readEditableFields('edit'), {
      updatedAt: Utils.nowISO()
    });
    await DB.upsert(updated);
    this._editingId = null;
    this.showToast('保存成功');
    await this.refreshRecordList();
    this.showPage('page-session');
  },

  async _confirmDeleteSession(sessionId) {
    const session = await DB.getSession(sessionId);
    if (!session) return;
    const modal = document.getElementById('modal-confirm-delete');
    modal.dataset.type = 'session';
    modal.dataset.id = sessionId;
    document.getElementById('delete-message').textContent = '确定要删除会话「' + session.name + '」及其所有记录吗？';
    modal.classList.add('active');
  },

  _confirmDeleteRecord(recordId) {
    const modal = document.getElementById('modal-confirm-delete');
    modal.dataset.type = 'record';
    modal.dataset.id = recordId;
    document.getElementById('delete-message').textContent = '确定要删除这条扫码记录吗？';
    modal.classList.add('active');
  },

  async _executeDelete() {
    const modal = document.getElementById('modal-confirm-delete');
    const type = modal.dataset.type;
    const id = modal.dataset.id;
    modal.classList.remove('active');
    if (type === 'session') {
      await DB.deleteSession(id);
      this.showToast('会话已删除');
      await this.refreshSessionList();
      return;
    }
    await DB.delete(id);
    this.showToast('记录已删除');
    await this.refreshRecordList();
  },

  async _exportCurrentSession() {
    const records = await DB.getRecordsBySession(this.currentSessionId);
    if (!records.length) {
      this.showToast('没有可导出的记录', true);
      return;
    }
    const session = await DB.getSession(this.currentSessionId);
    const name = session ? session.name.replace(/[^\w一-龥]/g, '_') : '盘点';
    ExportUtils.toExcel(records.slice().reverse(), name + '_' + this._timestamp() + '.xlsx');
    this.showToast('导出成功');
  },

  async _exportAll() {
    const sessions = await DB.getAllSessions();
    const allRecords = [];
    for (const session of sessions) {
      const records = await DB.getRecordsBySession(session.id);
      records.forEach((record) => allRecords.push(Object.assign({}, record, { _sessionName: session.name })));
    }
    if (!allRecords.length) {
      this.showToast('没有可导出的记录', true);
      return;
    }
    ExportUtils.toExcel(allRecords.reverse(), '全部盘点_' + this._timestamp() + '.xlsx');
    this.showToast('导出成功');
  },

  _timestamp() {
    return Utils.formatDate(Utils.nowISO()).replace(/[ :]/g, '-');
  },

  _registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(() => {});
  },

  _bindEvents() {
    document.getElementById('btn-refresh-data').addEventListener('click', () => this._loadBasicData());
    document.getElementById('btn-export-all').addEventListener('click', () => this._exportAll());
    document.getElementById('btn-new-session').addEventListener('click', () => {
      document.getElementById('input-session-name').value = new Date().toLocaleDateString('zh-CN') + ' SIT 仓库盘点';
      document.getElementById('modal-new-session').classList.add('active');
      setTimeout(() => document.getElementById('input-session-name').focus(), 50);
    });
    document.getElementById('btn-create-session').addEventListener('click', async () => {
      const name = document.getElementById('input-session-name').value.trim();
      if (!name) {
        this.showToast('请输入会话名称', true);
        return;
      }
      document.getElementById('modal-new-session').classList.remove('active');
      const session = await DB.createSession(name);
      await this.refreshSessionList();
      await this.openSession(session.id);
      await this.openScanner();
    });
    document.getElementById('btn-cancel-session').addEventListener('click', () => document.getElementById('modal-new-session').classList.remove('active'));
    document.getElementById('btn-cancel-manual-record').addEventListener('click', () => document.getElementById('modal-manual-record').classList.remove('active'));
    document.getElementById('btn-create-manual-record').addEventListener('click', () => this._createManualRecord());
    document.getElementById('btn-open-stock').addEventListener('click', () => {
      const body = document.getElementById('stock-module-body');
      const arrow = document.querySelector('#stock-module .module-arrow');
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      arrow.textContent = isHidden ? '▾' : '›';
    });
    document.getElementById('btn-back-home').addEventListener('click', async () => {
      await Scanner.stop();
      await this.refreshSessionList();
      this.showPage('page-home');
    });
    document.getElementById('btn-back-session').addEventListener('click', async () => {
      await Scanner.stop();
      await this.refreshRecordList();
      this.showPage('page-session');
    });
    document.getElementById('btn-start-scan').addEventListener('click', () => this.openScanner());
    document.getElementById('btn-open-manual-record').addEventListener('click', () => this.openManualRecord());
    document.getElementById('btn-export-session').addEventListener('click', () => this._exportCurrentSession());
    document.getElementById('btn-back-from-edit').addEventListener('click', async () => {
      this._editingId = null;
      await this.refreshRecordList();
      this.showPage('page-session');
    });
    document.getElementById('edit-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this._saveEditedRecord();
    });
    document.getElementById('btn-dup-overwrite').addEventListener('click', () => {
      document.getElementById('modal-duplicate').classList.remove('active');
      this._renderScanForm(this._pendingRecord, 'scan');
    });
    document.getElementById('btn-dup-cancel').addEventListener('click', async () => {
      document.getElementById('modal-duplicate').classList.remove('active');
      this._pendingRecord = null;
      this._pendingDuplicateRecord = null;
      this._pendingRecordSource = 'scan';
      await this.openScanner();
    });
    document.getElementById('btn-manual-overwrite').addEventListener('click', async () => {
      document.getElementById('modal-manual-duplicate').classList.remove('active');
      await this._openManualRecordForm(this._pendingRecord);
    });
    document.getElementById('btn-manual-reenter').addEventListener('click', () => {
      document.getElementById('modal-manual-duplicate').classList.remove('active');
      this._pendingRecord = null;
      this._pendingDuplicateRecord = null;
      this._pendingRecordSource = 'manual';
      this.openManualRecord();
    });
    document.getElementById('btn-cancel-delete').addEventListener('click', () => document.getElementById('modal-confirm-delete').classList.remove('active'));
    document.getElementById('btn-confirm-delete').addEventListener('click', () => this._executeDelete());
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.classList.remove('active');
      });
    });
    window.addEventListener('beforeunload', () => Scanner.stop());
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
