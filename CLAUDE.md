# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

这是一个纯静态的仓库盘点小程序（PWA 风格），核心目标是：
- 扫描 18 位托盘条形码创建盘点记录
- 或手动输入托盘号创建记录
- 结合本地基础数据带出发票号 / 零件号 / 数量 / 状态
- 允许用户补充库位号、备注和其他字段
- 最终导出 Excel 留存

运行时**只读取** `docs/basic-data.json`；Excel 源数据不会在前端直接解析。当前源文件是项目根目录的 `juyue发货情况261105.xlsx`，由 `scripts/build-basic-data.py` 生成 JSON（支持传参指定源文件：`python scripts/build-basic-data.py 文件名.xlsx`，不传参用脚本内 `DEFAULT_SOURCE`）。

## 常用命令

### 本地预览

```bash
python -m http.server 8080
```

打开 `http://localhost:8080/` 访问应用。

### 重新生成基础数据

```bash
python scripts/build-basic-data.py
```

### 回归脚本

```bash
node scripts/test-scanner-start.js
node scripts/test-manual-record.js
node scripts/test-delete-modal.js
```

单测脚本都是无测试框架的 Node 校验脚本；如果只验证某一块逻辑，直接运行对应脚本即可。

### 语法检查

```bash
node --check js/app.js
node --check js/db.js
node --check js/scanner.js
node --check js/export.js
node --check js/data.js
node --check js/utils.js
node --check sw.js
python -m py_compile scripts/build-basic-data.py
```

### Docker 构建

```bash
docker build -t stock-sit-review .
```

## 高层架构

- `index.html`
  - 单页入口。
  - 页面层主要是：`page-home`、`page-session`、`page-scanner`、`page-edit`。
  - `page-scanner` 不只是摄像头页，也承载**扫码后的维护表单**和**手动创建记录的维护表单**。
  - 多个 modal（新建会话、重复记录、手动创建、确认删除）都在这里，`app.js` 直接通过固定 DOM id 绑定事件。

- `js/app.js`
  - 主控制器和业务编排中心。
  - 负责：页面切换、会话管理、记录列表、扫码创建、手动创建、重复记录覆盖、保存/编辑/删除、最近扫码列表、导出和 service worker 注册。
  - `page-session -> page-scanner -> _renderScanForm()` 是扫码流和手动流共享的核心路径。
  - 记录对象目前会带 `sourceMatched`、`result/resultLabel`、`updatedAt`、`entryMode ('scan' | 'manual')` 等字段。

- `js/scanner.js`
  - `html5-qrcode` 的封装层，当前只启用 `CODE_128`。
  - 不要把它理解成“一次扫码就销毁实例”的实现：它会复用 `Html5Qrcode` 实例（`_ensureScanner()`），扫码成功后只 `_pause()`，避免 iOS Safari 频繁重建摄像头状态。
  - 如果暂停后的旧实例无法 restart，会走 `_recreateScanner()`，这是为了解决“继续扫码时摄像头打不开”的问题。
  - iOS Safari 目前有专门调优：较低 fps、较高理想分辨率、窄长扫码框，以及重建/后置摄像头 fallback。

- `js/data.js`
  - 加载 `docs/basic-data.json`，做最小结构校验，并将托盘号映射缓存到内存 `Map`。
  - 前端所有“命中基础数据 / 未命中基础数据”的判断都依赖这里。

- `js/db.js`
  - IndexedDB 持久化层。
  - 主要 object store：`sessions`、`records`。
  - `recordCount` 是由 `upsert()` / `delete()` 顺带维护的，不是实时聚合查询。

- `js/export.js`
  - 用 `xlsx.full.min.js` 生成导出文件。
  - 导出是纯前端完成，不依赖在线服务。

- `sw.js` + `nginx.conf`
  - `sw.js` 缓存静态资源。
  - `nginx.conf` 对 `docs/basic-data.json`、`sw.js`、`manifest.json` 强制 no-cache，其余静态资源允许长期缓存。
  - 这意味着**改了 HTML / JS / CSS 后要同步 bump 版本字符串**，否则浏览器和 service worker 很容易继续命中旧资源。

- `scripts/build-basic-data.py`
  - 直接按 XLSX ZIP/XML 结构读取数据，不依赖 pandas/openpyxl。
  - 输出格式是前端运行时唯一基础数据源 `docs/basic-data.json`。

## 关键业务流

### 1. 基础数据构建流

1. 更新源 Excel（如 `juyue发货情况261105.xlsx`）
2. 运行 `python scripts/build-basic-data.py [源文件名.xlsx]`
3. 生成 `docs/basic-data.json`（用错旧文件会静默生成旧数据，务必核对输出的托盘数与首页"来源"文件名）
4. 前端启动后由 `DataStore.load()` 读取并建内存映射

### 2. 扫码创建记录

1. `page-session` 点击“开始扫码”
2. `App.openScanner()` 切到 `page-scanner`
3. `Scanner.start()` 打开摄像头并识别 18 位托盘码
4. `App._handleScannedPallet()` 查当前会话内是否重复
5. `App._buildRecord()` 用基础数据带出字段
6. `App._renderScanForm(record, 'scan')` 打开维护表单
7. `App._saveScanRecord()` 保存后回到扫码页继续扫描

### 3. 手动创建记录

1. `page-session` 点击“手动创建”
2. 先弹托盘号输入弹窗
3. `App._createManualRecord()` 校验并准备记录
4. `App._openManualRecordForm(record)` 切到 `page-scanner`
5. `App._renderScanForm(record, 'manual')` 打开维护表单
6. `App._saveScanRecord()` 保存后返回 `page-session`

## 当前实现约束

- **扫码**只接受 18 位纯数字托盘号。
- **手动创建**允许任意非空托盘号；未命中基础数据时仍允许保存。
- 重复记录判断现在是**当前会话内按托盘号判断**，不是全局判断。
- `page-scanner` 同时服务于扫码和手动维护；不要把“手动创建记录”理解成独立页面。
- 删除按钮依赖 `index.html` 中确认删除弹窗的固定 DOM id：
  - `modal-confirm-delete`
  - `delete-message`
  - `btn-cancel-delete`
  - `btn-confirm-delete`
  如果这些 id 丢了，所有删除入口都会失效。
- 改动静态资源后，至少同步检查这些版本号是否一致：
  - `index.html` 中各个 `?v=...`
  - `sw.js` 的 `VERSION`
  - `js/app.js` 的 `App.VERSION`
  - `js/data.js` 的 `DataStore.VERSION`（**数据更新也必须 bump**，否则 SW 缓存导致客户端落后一次加载、"刷新"按钮要点两次才生效）

## 对后续 Claude 实例最重要的注意点

- 不要随意重写扫码生命周期；`js/scanner.js` 的 `_pause()` / `_ensureScanner()` / `_recreateScanner()` 是为 iOS Safari 稳定性补出来的。
- 手动创建和扫码创建共用 `_renderScanForm()`、`_saveScanRecord()`，修其中一个流程时要看另一个是否被连带影响。
- 当前测试不是浏览器 E2E，而是**Node 脚本对关键状态流做回归验证**；改手动创建、删除弹窗、扫码生命周期时，优先更新这些脚本并跑一遍。
- `docs/basic-data.json` 更新后，如果只是数据变了，通常重跑构建脚本即可；如果用户端仍读旧静态资源，再考虑同步更新版本字符串。