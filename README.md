# 仓库盘点小程序

针对 SIT 仓库托盘标签的轻量盘点工具。运行时读取 `docs/basic-data.json`，扫码 Handling Unit Number 位置的 18 位托盘条形码后匹配基础数据，记录库位号和备注，并支持导出 Excel。

## 更新基础数据

源表更新后运行：

```bash
python scripts/build-basic-data.py
```

脚本会读取项目根目录的 `juyue发货情况260605.xlsx`，生成 `docs/basic-data.json`。

## 本地运行

```bash
python -m http.server 8080
```

然后打开 `http://localhost:8080/`。

扫码功能需要浏览器摄像头权限，手机访问时建议使用 HTTPS 或同局域网可信环境。
