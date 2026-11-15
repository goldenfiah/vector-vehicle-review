PRAGMA foreign_keys = ON;

INSERT INTO projects (id, name, code, role, contract, image_name, image_width, image_height, checksum)
VALUES ('yard-a', '车辆巡查 A 区', 'PRJ-V-0271', '车辆分析员', 'vehicle-detection/0.2',
        'yard.svg', 1800, 1200, 'c4b7e2a91d63f8057a2e0c9b41d6e3a8');

INSERT INTO media (project_id, kind, filename, width, height, checksum)
VALUES ('yard-a', 'image', 'yard.svg', 1800, 1200, 'c4b7e2a91d63f8057a2e0c9b41d6e3a8');

INSERT INTO detections
  (id, project_id, media_id, label, polygon_json, score, tile, state, origin, note, reasons_json)
VALUES
  (1, 'yard-a', 1, 'truck', '[[760,300],[905,290],[910,332],[765,342]]', 0.96, 3, 'pending', 'model', '', '[]'),
  (2, 'yard-a', 1, 'car',   '[[1020,330],[1122,334],[1118,368],[1016,364]]', 0.93, 3, 'pending', 'model', '', '[]'),
  (3, 'yard-a', 1, 'truck', '[[590,665],[632,675],[620,803],[578,793]]', 0.91, 2, 'pending', 'model', '', '[]'),
  (4, 'yard-a', 1, 'truck', '[[1210,620],[1356,690],[1338,730],[1192,660]]', 0.88, 5, 'pending', 'model', '', '[]'),
  (5, 'yard-a', 1, 'van',   '[[1440,720],[1546,697],[1553,733],[1447,756]]', 0.84, 6, 'pending', 'model', '', '[]'),
  (6, 'yard-a', 1, 'van',   '[[745,940],[861,946],[859,986],[743,980]]', 0.78, 4, 'pending', 'model', '', '[]'),
  (7, 'yard-a', 1, 'car',   '[[1030,800],[1125,769],[1136,803],[1041,834]]', 0.73, 5, 'pending', 'model', '', '[]'),
  (8, 'yard-a', 1, 'car',   '[[1510,360],[1623,376],[1617,414],[1504,398]]', 0.62, 7, 'pending', 'model', '', '["贴边目标"]'),
  (9, 'yard-a', 1, 'car',   '[[420,900],[515,887],[520,919],[425,932]]', 0.41, 1, 'pending', 'model', '', '["低置信度"]');

INSERT INTO tasks (project_id, status, tiles_total, tiles_done, attempt, final_count, finished_at)
VALUES ('yard-a', 'done', 9, 9, 1, 9, CURRENT_TIMESTAMP);

INSERT INTO versions (project_id, label, author, summary)
VALUES ('yard-a', '模型原始结果', 'yolov8l-obb', '模型输出，未修订');

INSERT INTO version_items (version_id, detection_id, state, polygon_json, note)
SELECT 1, id, state, polygon_json, note FROM detections;
