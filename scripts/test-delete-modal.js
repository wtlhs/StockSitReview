'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

const requiredIds = [
  'modal-confirm-delete',
  'delete-message',
  'btn-cancel-delete',
  'btn-confirm-delete'
];

for (const id of requiredIds) {
  assert(html.includes(`id="${id}"`), `Missing delete modal element: ${id}`);
}

console.log('delete modal markup checks passed');
