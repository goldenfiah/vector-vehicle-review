# VECTOR 车辆检测复核系统

面向物流园车辆巡查的检测与人工复核应用：浏览器 Canvas 复核台、Python 标准库后端、SQLite 数据库、原模型接入与可验证测试。

## 功能

- 登录与会话保持
- 项目总览、检测任务、复核台
- 车辆旋转框确认 / 删除 / AI 补框 / 版本快照
- 疑难队列、区域中心点计数、修订档案
- JSON / CSV / PNG 报告输出
- 智能检测与模型接入，失败明确回退 `LOCAL / MOCK`
- 使用说明、响应式布局、交互反馈

## 运行

```bash
python database/build_db.py
python backend/server.py
```

打开 `http://127.0.0.1:8100/index.html`。

## 目录

```text
frontend/          前端单页与检测页
backend/           Python 标准库 HTTP API
database/          schema.sql / seed.sql / build_db.py / vehicle.db
tests/             API 测试
docs/              SPEC / DESIGN / AI 协作 / 交互记录 / 测试 / 数据库说明
```

## 测试

```bash
python -m unittest discover -s tests -v
```

## 说明

- 前端为原生 HTML / CSS / JavaScript，无 node_modules、无构建步骤。
- 后端只依赖 Python 标准库与 sqlite3。
- 模型服务未启动时，检测页使用内置车辆场景并显示 `LOCAL / MOCK`。
