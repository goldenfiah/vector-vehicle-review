-- VECTOR vehicle review database / SQLite 3
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS version_items;
DROP TABLE IF EXISTS versions;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS detections;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS projects;

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL DEFAULT '项目分析员',
  contract      TEXT NOT NULL DEFAULT 'vehicle-detection/0.2',
  image_name    TEXT NOT NULL,
  image_width   INTEGER NOT NULL CHECK (image_width > 0),
  image_height  INTEGER NOT NULL CHECK (image_height > 0),
  checksum      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  filename      TEXT NOT NULL,
  width         INTEGER NOT NULL CHECK (width > 0),
  height        INTEGER NOT NULL CHECK (height > 0),
  checksum      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE detections (
  id            INTEGER PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  media_id      INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  label         TEXT NOT NULL CHECK (label IN ('car', 'truck', 'van', 'bus')),
  polygon_json  TEXT NOT NULL,
  score         REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  tile          INTEGER NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (state IN ('pending', 'confirmed', 'modified', 'deleted')),
  origin        TEXT NOT NULL DEFAULT 'model'
                 CHECK (origin IN ('model', 'manual', 'ai')),
  note          TEXT NOT NULL DEFAULT '',
  reasons_json  TEXT NOT NULL DEFAULT '[]',
  reviewed_by   TEXT,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('running', 'done', 'cancelled', 'failed')),
  tiles_total   INTEGER NOT NULL DEFAULT 9,
  tiles_done    INTEGER NOT NULL DEFAULT 0,
  attempt       INTEGER NOT NULL DEFAULT 1,
  final_count   INTEGER,
  started_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   TEXT
);

CREATE TABLE versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  author        TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE version_items (
  version_id    INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  detection_id  INTEGER NOT NULL REFERENCES detections(id) ON DELETE CASCADE,
  state         TEXT NOT NULL,
  polygon_json  TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (version_id, detection_id)
);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT NOT NULL,
  action        TEXT NOT NULL,
  target        TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_detections_project ON detections(project_id, state);
CREATE INDEX idx_detections_media ON detections(media_id);
CREATE INDEX idx_versions_project ON versions(project_id, id DESC);
CREATE INDEX idx_audit_project ON audit_log(project_id, id DESC);
