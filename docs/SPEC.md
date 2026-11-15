# VECTOR 车辆检测复核系统 — 规格说明书（SPEC）

版本：1.0  
日期：2026-11-14  
状态：与当前 `vehicle-platform/frontend`、`backend/server.py`、`database/schema.sql` 同步  
项目：基于 AI 工具的小型应用开发

## 1. 问题与目标

物流园堆场的车辆巡查需要从影像中检出车辆、人工确认旋转框、保留修订版本，并将结果导出为可复核报告。现有演示代码与早期参考前端项目高度同源，无法满足“独立实现、可审查、可测试”的交付要求。

本规格定义一个车辆检测复核系统：

- 浏览器完成登录、项目总览、检测任务、复核、区域计数、版本与导出；
- 后端提供项目、目标、版本、任务 API，并持久化到 SQLite；
- 智能检测页可调用原有检测模型服务，服务不可用时明确回退演示结果；
- 代码、数据、测试与 AI 协作过程均可追溯。

## 2. 角色与场景

| 角色 | 目标 |
|---|---|
| 项目分析员 | 进入项目、查看影像、创建任务、复核目标 |
| 复核员 | 确认 / 修改 / 删除车辆框，保存版本 |
| 项目负责人 | 查看区域统计与版本摘要，导出报告 |
| 开发者 | 按 SPEC 实现、测试、记录 AI 协作 |

核心场景：

1. 分析员登录后进入车辆巡查 A 区，看到 9 个模型候选。
2. 创建检测任务，观察 9 个切片进度与最终数量。
3. 在复核台确认 / 删除目标，保存人工版本。
4. 圈选区域，按中心点统计区域车辆。
5. 导出 JSON / CSV / PNG 快照。
6. 在智能检测页载入图片，调用原模型接口；接口不可用时使用演示结果。

## 3. 功能需求

| 编号 | 需求 | 验收标准 |
|---|---|---|
| F1 | 登录与会话 | 账号 / 密码 / 项目必填；空值提示；7 天保持；退出清除 |
| F2 | 项目总览 | 显示项目、影像、候选数、已复核数与最新版本 |
| F3 | 检测任务 | 9 切片进度；临时候选与最终数量分离；取消 / 重试可用 |
| F4 | 复核台 | 列表筛选、画布选中、确认 / 删除、中心 / 宽高 / 四角坐标 |
| F5 | AI 补框 | 增加 AI 来源草稿框；保存版本后进入快照 |
| F6 | 区域计数 | 逐点圈选、双击闭合、中心点归属、全图口径 |
| F7 | 版本档案 | v0 只读；每次保存追加版本；显示作者 / 时间 / 摘要 |
| F8 | 报告输出 | JSON / CSV / PNG；绑定当前版本；空数据禁用 |
| F9 | 智能检测 + 模型接入 | 载入图片；调用 `/api/v1/vision/detect`；失败回退并显示 `LOCAL / MOCK` |
| F10 | 使用说明 | 九个模块的用途、操作与快捷键；移动端可读 |

### 3.1 边界与异常

- 空项目 / 空目标：显示空态，不渲染空表。
- 非法复核状态：后端返回 `422 BAD_STATE`。
- 不存在的目标：`404 DETECTION_NOT_FOUND`。
- 模型服务不可达：前端捕获错误，标记 `LOCAL / MOCK`，给出 toast，不伪造模型结果。
- 后端不可达：前端回退本地演示，标记 `本地演示`。
- 所有坐标使用 1800 × 1200 原图像素；画布缩放不改变数据坐标。

## 4. 非功能需求

| 编号 | 要求 |
|---|---|
| N1 | 1440 / 1026 / 390 三档响应式；无横向溢出 |
| N2 | 首屏 LCP 资源 < 1 MB（不含示例 SVG）；无构建依赖 |
| N3 | 键盘可完成登录、复核删除、区域操作；可见焦点 |
| N4 | `prefers-reduced-motion` 时关闭启动序列、扫描线与 reveal |
| N5 | 代码分层：`frontend` / `backend` / `database` / `tests` / `docs` |
| N6 | 关键函数有注释；API 错误统一 JSON 结构 |
| N7 | 无 node_modules、无第三方运行时依赖 |
| N8 | 交互反馈：按钮 ripple / busy、登录校验 shake、数据加载遮罩、同步状态、toast、focus-visible |

## 5. 系统设计

### 5.1 架构

```
浏览器（frontend）
  index.html / app.js / app.css
  detect.html / detect.js / model.js
        │  fetch /api/*          │  fetch 原模型 8000
        ▼                        ▼
后端 server.py（stdlib HTTP）   原检测模型服务
        │ sqlite3
        ▼
database/vehicle.db
```

- 前端不直接访问 SQLite；所有业务数据经 `/api`。
- 智能检测的模型调用与业务 API 分离：模型在 8000，业务在 8100。
- 后端同时托管静态前端，避免 CORS 与路径分裂。

### 5.2 数据模型

见 `database/schema.sql` 与 `docs/images/er.png`。

- `projects` 1—N `media`
- `media` 1—N `detections`
- `projects` 1—N `tasks`
- `projects` 1—N `versions`
- `versions` N—N `detections`（`version_items` 快照）
- `audit_log` 记录复核 / 版本 / 任务动作

`detections.state` 使用 CHECK 约束限制为 `pending / confirmed / modified / deleted`；`polygon_json` 保存原图像素多边形。

### 5.3 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态 |
| GET | `/api/projects/{id}` | 项目 + 状态计数 |
| GET | `/api/projects/{id}/detections` | 目标列表 |
| PATCH | `/api/detections/{id}` | 更新 state / note / label |
| GET | `/api/projects/{id}/stats` | 区域 / 全图计数 |
| GET/POST | `/api/projects/{id}/versions` | 版本列表 / 保存快照 |
| POST | `/api/projects/{id}/tasks` | 创建已完成任务记录 |

错误格式：

```json
{ "error": { "code": "BAD_STATE", "message": "复核状态非法" } }
```

## 6. 界面与交互

- 左侧模块栏 + 顶部指令条；九个模块。
- 纸张 / 墨色 / 深绿 / 橙色设计令牌；大号衬线标题与等宽微标签。
- 动效：启动序列、rail 滑条、视图错峰、数字计数、详情 flash、检测扫描线、ticker、自定义光标、磁吸按钮、滚动 reveal。
- 智能检测：左媒体、中画布、右属性 + AI 接入；模型状态显示在引擎标签。

## 7. 追溯矩阵

| 需求 | 实现 | 验证 |
|---|---|---|
| F1 | `index.html` `#auth-form`、`vector.session.v1` | 空表单 / 登录 / 刷新保持 |
| F2 | `viewProject()` | 页面显示 9 个候选、0 已复核 |
| F3 | `viewTask()` / `startTask()` | 9/9 切片、最终数量 9 |
| F4 | `viewWorkbench()` / `patchSelected()` | 选中、确认、API state 更新 |
| F5 | `addAiBox()` | 新增 AI 框，保存版本 |
| F6 | `viewStats()` / `pointInPolyWorld()` | 区域 5 个中心点 |
| F7 | `saveVersion()` / `/versions` | 追加版本、快照 9 条 |
| F8 | `exportAs()` | JSON / CSV 下载 |
| F9 | `model.js` / `runDetect()` | 桩接口返回 1 个 truck；离线回退 |
| F10 | `viewGuide()` | 1440 / 1026 / 390 无溢出 |
| N8 | `setBusy()` / `feedbackRipple()` / `.app-loader` | 登录校验、同步、保存、检测按钮 |

## 8. AI 协作与迭代记录

| 轮次 | 提示 / 决策 | 结果 |
|---|---|---|
| 1 | “按照参考站点风格修改 UI” | 建立纸张 / 墨色 / 大标题系统 |
| 2 | “从参考项目切换到车辆检测” | 数据、文案、`yard.svg`、类别改为 car / truck / van |
| 3 | “代码不能与参考版雷同” | 旧版相似度审查；新建 `frontend-v2` 独立实现 |
| 4 | “保留昨天的动画” | rail ink、错峰、计数、flash、扫描线、ticker、光标、磁吸、reveal |
| 5 | “使用说明排版乱” | 定位 `.reveal` 与密码显示类名冲突，改名 `scroll-reveal`；修复移动端 overflow |
| 6 | “接入原有模型” | `model.js` 调用 `/vision/sessions` + `/vision/detect`，失败回退 |

详细对话摘录与截图索引见 `AI_COLLAB.md`。

## 9. 验收与限制

- 已实现：上述 F1–F10 与 N1–N4 的主要路径。
- 数据库为 SQLite 演示库；真实部署可替换为 MySQL / PostgreSQL。
- 检测模型服务需单独启动在 8000；未启动时使用演示场景。
- 视频逐帧检测不在本版本范围；当前智能检测聚焦图片与模型接入。
- 账号为演示账号，不含真实鉴权、SSO 或找回密码。
