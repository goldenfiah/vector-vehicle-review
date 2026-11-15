# 数据库设计说明

数据库：SQLite 3，文件 `database/vehicle.db`  
建库脚本：`database/schema.sql` + `database/seed.sql`  
生成命令：`python database/build_db.py`

## 表结构

| 表 | 作用 | 关键字段 |
|---|---|---|
| `projects` | 项目 / 影像元信息 | `id`, `code`, `image_name`, `image_width`, `image_height`, `checksum` |
| `media` | 项目下的影像 / 视频 | `project_id`, `kind`, `filename`, `width`, `height` |
| `detections` | 车辆旋转框 | `media_id`, `label`, `polygon_json`, `score`, `tile`, `state`, `origin` |
| `tasks` | 检测任务 | `status`, `tiles_total`, `tiles_done`, `final_count` |
| `versions` | 人工修订版本 | `project_id`, `label`, `author`, `summary` |
| `version_items` | 版本快照 | `version_id`, `detection_id`, `state`, `polygon_json` |
| `audit_log` | 操作审计 | `action`, `target`, `detail` |

## 约束

- `detections.state`：`pending / confirmed / modified / deleted`
- `detections.label`：`car / truck / van / bus`
- `detections.origin`：`model / manual / ai`
- `detections.score`：0–1
- `projects.image_width/height > 0`
- 外键：`PRAGMA foreign_keys=ON`
- 索引：项目状态、媒体、版本、审计

## 关系

```
projects 1─N media 1─N detections
projects 1─N tasks
projects 1─N versions 1─N version_items N─1 detections
audit_log 独立记录 project_id
```

## 种子数据

- 1 个项目：车辆巡查 A 区（PRJ-V-0271）
- 1 个媒体：`yard.svg`，1800 × 1200
- 9 个车辆目标：4 个 car、3 个 truck、2 个 van
- 1 个已完成任务：9/9 切片，最终 9
- 1 个 v0 版本 + 9 条版本快照

## 常用检查

```sql
SELECT state, COUNT(*) FROM detections GROUP BY state;
SELECT id,label,score,state FROM detections ORDER BY id;
SELECT id,label,author,created_at FROM versions ORDER BY id DESC;
SELECT COUNT(*) FROM version_items WHERE version_id=1;
```
