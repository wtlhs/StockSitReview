'use strict';

const ExportUtils = {
  toExcel(records, filename) {
    if (!records || records.length === 0) {
      App.showToast('没有可导出的记录', true);
      return;
    }

    const header = ['序号', '托盘号', '状态判定', '原始状态', '发票号', '零件号', '数量', '库位号', '备注', '扫码时间', '所属会话', '更新时间'];

    const rows = records.map((record, index) => [
      index + 1,
      record.pallet || '',
      record.resultLabel || '',
      record.status || '',
      record.invoice || '',
      record.part || '',
      record.qty ?? '',
      record.location || '',
      record.remark || '',
      Utils.formatDate(record.scannedAt),
      record._sessionName || '',
      record.updatedAt ? Utils.formatDate(record.updatedAt) : ''
    ]);

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([header].concat(rows));

    worksheet['!cols'] = [
      { wch: 5 },
      { wch: 22 },
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 10 },
      { wch: 12 },
      { wch: 20 },
      { wch: 18 },
      { wch: 20 },
      { wch: 18 }
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, '盘点记录');

    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({
        files: [file],
        title: filename
      }).then(() => {
        App.showToast('导出成功');
      }).catch((error) => {
        if (error && error.name === 'AbortError') return;
        ExportUtils._fallbackDownload(blob, filename);
      });
      return;
    }

    ExportUtils._fallbackDownload(blob, filename);
  },

  _fallbackDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
