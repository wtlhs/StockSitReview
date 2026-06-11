#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_FILE = ROOT_DIR / 'juyue发货情况260605.xlsx'
OUTPUT_FILE = ROOT_DIR / 'docs' / 'basic-data.json'
NAMESPACE = {'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
PACKAGE_NAMESPACE = {'p': 'http://schemas.openxmlformats.org/package/2006/relationships'}
OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PALLET_PATTERN = re.compile(r'^\d{18}$')


def load_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if 'xl/sharedStrings.xml' not in archive.namelist():
        return []
    root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
    values: list[str] = []
    for item in root.findall('a:si', NAMESPACE):
        values.append(''.join(text.text or '' for text in item.findall('.//a:t', NAMESPACE)))
    return values


def resolve_first_sheet_path(archive: zipfile.ZipFile) -> str:
    workbook = ET.fromstring(archive.read('xl/workbook.xml'))
    relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
    relationship_map = {
        rel.attrib['Id']: rel.attrib['Target']
        for rel in relationships.findall('p:Relationship', PACKAGE_NAMESPACE)
    }
    sheets = workbook.find('a:sheets', NAMESPACE)
    if sheets is None or not list(sheets):
        raise ValueError('Excel 中未找到工作表')
    first_sheet = list(sheets)[0]
    relation_id = first_sheet.attrib.get(f'{{{OFFICE_REL_NS}}}id')
    if not relation_id or relation_id not in relationship_map:
        raise ValueError('无法解析首个工作表路径')
    target = relationship_map[relation_id]
    return target if target.startswith('xl/') else 'xl/' + target


def column_index(ref: str) -> int:
    col = ''.join(ch for ch in ref if ch.isalpha())
    value = 0
    for ch in col:
        value = value * 26 + ord(ch.upper()) - ord('A') + 1
    return value - 1


def read_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    value = cell.find('a:v', NAMESPACE)
    if value is None or value.text is None:
        return ''
    cell_type = cell.attrib.get('t')
    if cell_type == 's':
        return shared_strings[int(value.text)]
    return value.text


def read_rows(source_file: Path) -> list[list[str]]:
    with zipfile.ZipFile(source_file) as archive:
        shared_strings = load_shared_strings(archive)
        worksheet_path = resolve_first_sheet_path(archive)
        worksheet = ET.fromstring(archive.read(worksheet_path))

    rows: list[list[str]] = []
    for row in worksheet.findall('.//a:sheetData/a:row', NAMESPACE):
        cells: dict[int, str] = {}
        max_index = -1
        for cell in row.findall('a:c', NAMESPACE):
            idx = column_index(cell.attrib.get('r', 'A'))
            cells[idx] = read_cell_value(cell, shared_strings).strip()
            max_index = max(max_index, idx)
        rows.append([cells.get(i, '') for i in range(max_index + 1)])
    return rows


def normalize_header(value: str) -> str:
    return re.sub(r'\s+', '', value).upper()


def normalize_number(value: str) -> int | float | str:
    if value == '':
        return ''
    try:
        number = float(value)
    except ValueError:
        return value
    if number.is_integer():
        return int(number)
    return number


def normalize_text(value: str) -> str:
    if value.endswith('.0'):
        try:
            number = float(value)
            if number.is_integer():
                return str(int(number))
        except ValueError:
            pass
    return value.strip()


def normalize_status(value: str) -> str:
    text = normalize_text(value)
    if text in {'已出库', '�ѳ���'}:
        return '已出库'
    if text in {'未到库', 'δ����'}:
        return '未到库'
    if text in {'未出库', '未发货'}:
        return text
    return text or '未知'


def status_kind(status: str) -> str:
    return 'outbound' if status == '已出库' else 'normal'


def build_data(rows: list[list[str]]) -> dict[str, object]:
    if not rows:
        raise ValueError('Excel 内容为空')
    headers = [normalize_header(value) for value in rows[0]]
    required = {'INOVICE': 'invoice', 'INVOICE': 'invoice', 'PART': 'part', 'PALLET': 'pallet', 'QTY': 'qty', 'STATUS': 'status'}
    header_map: dict[str, int] = {}
    for idx, header in enumerate(headers):
        if header in required:
            header_map[required[header]] = idx
    for field in ['invoice', 'part', 'pallet', 'qty', 'status']:
        if field not in header_map:
            raise ValueError(f'缺少必要列：{field}')

    items: dict[str, dict[str, object]] = {}
    invalid_pallets: list[str] = []
    status_counts: dict[str, int] = {}

    for row in rows[1:]:
        if not row or all(not cell for cell in row):
            continue
        pallet = normalize_text(row[header_map['pallet']] if header_map['pallet'] < len(row) else '')
        if not pallet:
            continue
        if not PALLET_PATTERN.fullmatch(pallet):
            invalid_pallets.append(pallet)
            continue
        status = normalize_status(row[header_map['status']] if header_map['status'] < len(row) else '')
        status_counts[status] = status_counts.get(status, 0) + 1
        items[pallet] = {
            'invoice': normalize_text(row[header_map['invoice']] if header_map['invoice'] < len(row) else ''),
            'part': normalize_text(row[header_map['part']] if header_map['part'] < len(row) else ''),
            'pallet': pallet,
            'qty': normalize_number(row[header_map['qty']] if header_map['qty'] < len(row) else ''),
            'status': status,
            'statusKind': status_kind(status),
        }

    if not items:
        raise ValueError('未提取到有效托盘数据')

    return {
        'version': date.today().isoformat(),
        'source': SOURCE_FILE.name,
        'columns': ['invoice', 'part', 'pallet', 'qty', 'status'],
        'count': len(items),
        'statusCounts': status_counts,
        'items': dict(sorted(items.items())),
        'invalidPallets': invalid_pallets[:50],
        'invalidCount': len(invalid_pallets),
    }


def main() -> int:
    if not SOURCE_FILE.exists():
        raise FileNotFoundError(f'未找到源文件：{SOURCE_FILE}')
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = build_data(read_rows(SOURCE_FILE))
    OUTPUT_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'已生成 {OUTPUT_FILE}')
    print(f'有效托盘：{data["count"]}')
    print(f'状态统计：{data["statusCounts"]}')
    if data['invalidCount']:
        print(f'跳过无效托盘：{data["invalidCount"]}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'生成失败：{error}', file=sys.stderr)
        raise SystemExit(1)
