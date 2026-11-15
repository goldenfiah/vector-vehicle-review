# 测试与结果记录

日期：2026-11-14  
环境：Windows / Python 3.13 / SQLite 3 / Chromium（Playwright）  
入口：`http://127.0.0.1:8100/index.html`

## 1. 如何运行

```bash
# 1) 重建数据库
python database/build_db.py

# 2) 启动后端 + 静态前端
python backend/server.py
# 打开 http://127.0.0.1:8100/index.html

# 3) API 测试（另开终端，服务保持运行）
python -m unittest discover -s tests -v
```

## 2. API 测试结果

执行：

```bash
python -m unittest discover -s tests -v
```

实际输出：

```text
test_add_detection ... ok\ntest_bad_state ... ok\ntest_health ... ok
test_missing_detection ... ok
test_patch_and_version ... ok
test_project_and_detections ... ok
----------------------------------------------------------------------
Ran 6 tests in 1.827s
OK
```

| 用例 | 预期 | 实际 |
|---|---|---|
| `GET /api/health` | 200 + `status=ok` | 通过 |
| `GET /api/projects/yard-a` | 总数 9 | 通过 |
| `GET /api/projects/yard-a/detections` | 9 条，polygon ≥ 3 点 | 通过 |
| `PATCH /api/detections/1` | state 更新为 confirmed | 通过 |
| `POST /api/projects/yard-a/versions` | 201，新增版本 | 通过 |
| `POST /api/projects/yard-a/detections` | 201，AI 补框写入 | 通过 |
| `PATCH /api/detections/2` 非法 state | 422 `BAD_STATE` | 通过 |
| `PATCH /api/detections/9999` | 404 | 通过 |

## 3. 数据库检查

重建后：

```text
built database/vehicle.db
{'projects': 1, 'media': 1, 'detections': 9, 'tasks': 1, 'versions': 1, 'version_items': 9}
```

- `detections.state` CHECK 约束拒绝非法值；
- `version_items` 保存 9 条快照；
- 复核后 `confirmed` 计数从 0 → 1，`pending` 从 9 → 8；
- 测试后已重建数据库，初始状态恢复为 9 个待检查。

## 4. 前端功能测试

| 场景 | 操作 | 结果 |
|---|---|---|
| 登录空值 | 清空账号提交 | 错误提示 + shake + invalid + focus |
| 登录成功 | 预填账号 / 密码 | 进入项目总览，sync 显示 `SQLITE / API` |
| 项目总览 | 查看指标 | 9 个候选、0 已复核、v0 |
| 检测任务 | 开始检测 | 9/9 切片，最终数量 9，进入复核台可用 |
| 复核台 | 选中 #1，确认 | 列表状态改为已确认；API 查询 state=confirmed |
| 复核台 | 保存修订 | 按钮显示「保存中…」并禁用，完成后恢复 |
| 区域计数 | 圈选 4 点，双击闭合 | 区域内 5 个中心点 |
| 使用说明 | 1440 / 1026 / 390 | 无重叠；移动端无横向滚动条 |
| AI 接口 | 配置地址 | 保存后状态「已接入」 |
| 模型调用 | 桩接口返回 1 个 truck | 引擎 `MODEL / HTTP`，列表 1 条 |
| 模型离线 | 不启动 8000 | 引擎 `LOCAL / MOCK`，提示回退 |

## 5. 响应式与可访问性

- 1440：左侧栏 + 三栏复核台；说明页目录双列。
- 1026：复核台属性面板下移；说明页目录双列 / 单列过渡。
- 390：模块栏横向滚动，当前模块自动居中；说明页单列；`scrollWidth=375 < 390`，无横向溢出。
- 键盘：登录 Tab / Enter；复核 Delete / Ctrl+Z / Ctrl+Y / Esc；检测 Space / F / 1 / P。
- `prefers-reduced-motion`：关闭启动序列、扫描线、reveal 与计数动画。

## 6. 未覆盖 / 限制

- 真实模型服务未在本次环境启动；使用接口桩验证请求 / 响应映射，离线回退已测。
- 视频逐帧检测不在当前版本范围。
- 账号为演示账号，未接真实鉴权、SSO、找回密码。
- 未做长时间压力测试与多用户并发测试。
