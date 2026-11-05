'use strict';

const DataStore = {
  VERSION: '20261105-01',
  _data: null,
  _map: new Map(),

  async load() {
    const response = await fetch('docs/basic-data.json?_v=' + encodeURIComponent(this.VERSION), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('基础数据加载失败：HTTP ' + response.status);
    }
    const data = await response.json();
    this._validate(data);
    this._data = data;
    this._map = new Map(Object.entries(data.items));
    return data;
  },

  _validate(data) {
    if (!data || typeof data !== 'object') throw new Error('基础数据格式错误');
    if (!data.items || typeof data.items !== 'object' || Array.isArray(data.items)) {
      throw new Error('基础数据缺少 items');
    }
    Object.keys(data.items).forEach((pallet) => {
      if (!/^\d{18}$/.test(pallet)) {
        throw new Error('基础数据包含无效托盘号：' + pallet);
      }
    });
  },

  find(pallet) {
    return this._map.get(pallet) || null;
  },

  meta() {
    return this._data;
  }
};
