# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## 项目概览

这是一个纯静态的仓库盘点小程序，核心目标是：扫码 18 位托盘条形码，读取本地基础数据，生成盘点记录，允许用户编辑库位号和备注，并导出 Excel 留存。

基础数据不是直接在线解析 Excel，而是先由 `scripts/build-basic-data.py` 从 `juyue发货情况260605.xlsx` 生成 `docs/basic-data.json`，前端运行时只读取 JSON。

## 关键架构

- `index.html` 是单页入口，页面分为首页、盘点详情、扫码页、编辑页和几个弹窗。
- `js/app.js` 是主控制器，负责页面切换、会话管理、扫码结果处理、记录保存、编辑、删除和导出。
- `js/data.js` 负责加载和校验 `docs/basic-data.json`，并把托盘号映射缓存到内存。
- `js/db.js` 用 IndexedDB 保存盘点会话和记录，是本地持久化层。
- `js/scanner.js` 封装 `html5-qrcode`，只接受 18 位数字托盘码，并在扫码框中做视觉引导。
- `js/export.js` 负责把记录导出成 Excel。
- `scripts/build-basic-data.py` 负责把源 Excel 转成前端运行时 JSON。
- `sw.js` 提供静态资源缓存，便于离线和重复访问。

## 数据流

1. Excel 源表更新。
2. 运行 `scripts/build-basic-data.py` 生成 `docs/basic-data.json`。
3. 前端启动时加载 JSON，校验托盘号格式并构建内存映射。
4. 扫码获取 18 位托盘号后，结合基础数据生成记录。
5. 记录写入 IndexedDB，用户可继续补充库位号、备注，以及编辑基础带出字段。
6. 导出时从 IndexedDB 读取当前记录集，生成 Excel。

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

源数据来自项目根目录的 `juyue发货情况260605.xlsx`，输出为 `docs/basic-data.json`。

### 语法检查

当前项目没有 npm 脚本或测试框架，常用的是直接做语法检查：

```bash
node --check js/app.js
node --check js/db.js
node --check js/scanner.js
node --check js/export.js
node --check js/data.js
node --check sw.js
python -m py_compile scripts/build-basic-data.py
```

单文件检查时，直接对目标文件跑对应命令即可，例如：

```bash
node --check js/app.js
```

### Docker 构建

仓库根目录包含 `Dockerfile` 和 `nginx.conf`，可直接构建静态镜像：

```bash
docker build -t stock-sit-review .
```

## 需要特别注意的约束

- 扫码只接受 18 位纯数字托盘号。
- `docs/basic-data.json` 是运行时主数据源，不要在前端重新解析 Excel。
- 扫码结果会把 `status` 为 `已出库` 的托盘标记为异常，其余视为正常。
- 扫码后要允许用户直接修改带出的发票号、零件号、数量、状态、库位号和备注，再保存到 IndexedDB。
- 导出 Excel 时保持当前记录字段顺序和可读性，不要把导出逻辑改成依赖在线服务。
