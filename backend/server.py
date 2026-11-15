"""VECTOR backend — stdlib HTTP + SQLite.

Serves the rewritten frontend and a small JSON API:
  GET    /api/health
  GET    /api/projects/<id>
  GET    /api/projects/<id>/detections
  PATCH  /api/detections/<id>
  GET    /api/projects/<id>/stats
  GET    /api/projects/<id>/versions
  POST   /api/projects/<id>/versions
  POST   /api/projects/<id>/tasks
"""
from __future__ import annotations

import json
import mimetypes
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database" / "vehicle.db"
FRONTEND = ROOT / "frontend"
HOST = "127.0.0.1"
PORT = 8100


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def row_dict(row):
    return {k: row[k] for k in row.keys()}


def detection_view(row):
    data = row_dict(row)
    data["polygon"] = json.loads(data.pop("polygon_json"))
    data["reasons"] = json.loads(data.pop("reasons_json"))
    return data


def project_view(conn, project_id):
    project = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        return None
    counts = {k: 0 for k in ("pending", "confirmed", "modified", "deleted")}
    rows = conn.execute(
        "SELECT state, COUNT(*) n FROM detections WHERE project_id=? GROUP BY state",
        (project_id,),
    ).fetchall()
    for row in rows:
        counts[row["state"]] = row["n"]
    data = row_dict(project)
    data["counts"] = {**counts, "total": sum(counts.values())}
    data["valid"] = counts["pending"] + counts["confirmed"] + counts["modified"]
    return data


class Handler(BaseHTTPRequestHandler):
    server_version = "VECTOR/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("请求体必须是 JSON")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self.api_get(path)
        return self.static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return self.json(404, {"error": {"code": "NOT_FOUND", "message": "接口不存在"}})
        try:
            payload = self.body()
        except ValueError as exc:
            return self.json(400, {"error": {"code": "BAD_JSON", "message": str(exc)}})
        return self.api_post(path, payload)

    def do_PATCH(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return self.json(404, {"error": {"code": "NOT_FOUND", "message": "接口不存在"}})
        try:
            payload = self.body()
        except ValueError as exc:
            return self.json(400, {"error": {"code": "BAD_JSON", "message": str(exc)}})
        return self.api_patch(path, payload)

    def api_get(self, path):
        conn = db()
        try:
            if path == "/api/health":
                return self.json(200, {
                    "service": "vector-review", "status": "ok",
                    "database": str(DB_PATH.name), "time": now()
                })
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 3 and parts[1] == "projects":
                project_id = parts[2]
                project = project_view(conn, project_id)
                if not project:
                    return self.json(404, {"error": {"code": "PROJECT_NOT_FOUND", "message": "项目不存在"}})
                if len(parts) == 3:
                    return self.json(200, project)
                if parts[3] == "detections":
                    rows = conn.execute(
                        "SELECT * FROM detections WHERE project_id=? ORDER BY id", (project_id,)
                    ).fetchall()
                    return self.json(200, {"items": [detection_view(r) for r in rows]})
                if parts[3] == "stats":
                    return self.json(200, {
                        "project_id": project_id,
                        "counts": project["counts"],
                        "valid": project["valid"],
                        "center_rule": "目标中心点落入区域才计数",
                    })
                if parts[3] == "versions":
                    rows = conn.execute(
                        "SELECT * FROM versions WHERE project_id=? ORDER BY id DESC", (project_id,)
                    ).fetchall()
                    items = []
                    for row in rows:
                        item = row_dict(row)
                        counts = conn.execute(
                            "SELECT state, COUNT(*) n FROM version_items WHERE version_id=? GROUP BY state",
                            (row["id"],),
                        ).fetchall()
                        item["counts"] = {r["state"]: r["n"] for r in counts}
                        item["count"] = sum(item["counts"].values())
                        items.append(item)
                    return self.json(200, {"items": items})
            return self.json(404, {"error": {"code": "NOT_FOUND", "message": "接口不存在"}})
        finally:
            conn.close()

    def api_patch(self, path, payload):
        parts = [p for p in path.split("/") if p]
        if len(parts) != 3 or parts[1] != "detections":
            return self.json(404, {"error": {"code": "NOT_FOUND", "message": "接口不存在"}})
        try:
            detection_id = int(parts[2])
        except ValueError:
            return self.json(400, {"error": {"code": "BAD_ID", "message": "目标编号非法"}})
        state = payload.get("state")
        if state is not None and state not in ("pending", "confirmed", "modified", "deleted"):
            return self.json(422, {"error": {"code": "BAD_STATE", "message": "复核状态非法"}})
        conn = db()
        try:
            row = conn.execute("SELECT * FROM detections WHERE id=?", (detection_id,)).fetchone()
            if not row:
                return self.json(404, {"error": {"code": "DETECTION_NOT_FOUND", "message": "目标不存在"}})
            fields, values = [], []
            for key in ("state", "note", "label"):
                if key in payload:
                    fields.append(key + "=?")
                    values.append(payload[key])
            if not fields:
                return self.json(422, {"error": {"code": "NO_FIELDS", "message": "没有可更新字段"}})
            fields.append("updated_at=?")
            values.append(now())
            values.append(detection_id)
            conn.execute("UPDATE detections SET " + ", ".join(fields) + " WHERE id=?", values)
            conn.execute(
                "INSERT INTO audit_log (project_id, action, target, detail) VALUES (?,?,?,?)",
                (row["project_id"], "review", "detection/" + str(detection_id), json.dumps(payload, ensure_ascii=False)),
            )
            conn.commit()
            updated = conn.execute("SELECT * FROM detections WHERE id=?", (detection_id,)).fetchone()
            return self.json(200, detection_view(updated))
        finally:
            conn.close()

    def api_post(self, path, payload):
        parts = [p for p in path.split("/") if p]
        if len(parts) == 4 and parts[1] == "projects" and parts[3] == "detections":
            project_id = parts[2]
            polygon = payload.get("polygon")
            if not isinstance(polygon, list) or len(polygon) < 3:
                return self.json(422, {"error": {"code": "BAD_POLYGON", "message": "polygon 至少需要 3 个点"}})
            label = payload.get("label") or "car"
            if label not in ("car", "truck", "van", "bus"):
                return self.json(422, {"error": {"code": "BAD_LABEL", "message": "车辆类别非法"}})
            conn = db()
            try:
                project = project_view(conn, project_id)
                media = conn.execute("SELECT id FROM media WHERE project_id=? LIMIT 1", (project_id,)).fetchone()
                if not project or not media:
                    return self.json(404, {"error": {"code": "PROJECT_NOT_FOUND", "message": "项目不存在"}})
                cur = conn.execute(
                    "INSERT INTO detections (project_id, media_id, label, polygon_json, score, tile, state, origin, note, reasons_json) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (project_id, media["id"], label, json.dumps(polygon), float(payload.get("score") or 0.7),
                     0, "pending", "ai", str(payload.get("note") or ""), "[]"),
                )
                conn.execute(
                    "INSERT INTO audit_log (project_id, action, target, detail) VALUES (?,?,?,?)",
                    (project_id, "add-detection", "detection/" + str(cur.lastrowid), "AI 补框"),
                )
                conn.commit()
                row = conn.execute("SELECT * FROM detections WHERE id=?", (cur.lastrowid,)).fetchone()
                return self.json(201, detection_view(row))
            finally:
                conn.close()
        if len(parts) == 4 and parts[1] == "projects" and parts[3] == "versions":
            project_id = parts[2]
            conn = db()
            try:
                project = project_view(conn, project_id)
                if not project:
                    return self.json(404, {"error": {"code": "PROJECT_NOT_FOUND", "message": "项目不存在"}})
                label = str(payload.get("label") or "人工修订")[:80]
                author = str(payload.get("author") or "lin.analyst")[:80]
                summary = str(payload.get("summary") or "")[:240]
                cur = conn.execute(
                    "INSERT INTO versions (project_id, label, author, summary, created_at) VALUES (?,?,?,?,?)",
                    (project_id, label, author, summary, now()),
                )
                version_id = cur.lastrowid
                conn.execute(
                    "INSERT INTO version_items (version_id, detection_id, state, polygon_json, note) "
                    "SELECT ?, id, state, polygon_json, note FROM detections WHERE project_id=?",
                    (version_id, project_id),
                )
                conn.execute(
                    "INSERT INTO audit_log (project_id, action, target, detail) VALUES (?,?,?,?)",
                    (project_id, "save-version", "version/" + str(version_id), summary),
                )
                conn.commit()
                return self.json(201, {"id": version_id, "label": label, "author": author, "summary": summary})
            finally:
                conn.close()
        if len(parts) == 4 and parts[1] == "projects" and parts[3] == "tasks":
            project_id = parts[2]
            conn = db()
            try:
                project = project_view(conn, project_id)
                if not project:
                    return self.json(404, {"error": {"code": "PROJECT_NOT_FOUND", "message": "项目不存在"}})
                final = project["valid"]
                cur = conn.execute(
                    "INSERT INTO tasks (project_id, status, tiles_total, tiles_done, attempt, final_count, finished_at) "
                    "VALUES (?, 'done', 9, 9, 1, ?, ?)",
                    (project_id, final, now()),
                )
                conn.execute(
                    "INSERT INTO audit_log (project_id, action, target, detail) VALUES (?,?,?,?)",
                    (project_id, "create-task", "task/" + str(cur.lastrowid), "9/9 tiles"),
                )
                conn.commit()
                return self.json(201, {"id": cur.lastrowid, "status": "done", "final_count": final})
            finally:
                conn.close()
        return self.json(404, {"error": {"code": "NOT_FOUND", "message": "接口不存在"}})

    def static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        target = (FRONTEND / path.lstrip("/")).resolve()
        try:
            target.relative_to(FRONTEND.resolve())
        except ValueError:
            return self.json(403, {"error": {"code": "FORBIDDEN", "message": "非法路径"}})
        if not target.exists() or not target.is_file():
            return self.json(404, {"error": {"code": "NOT_FOUND", "message": "文件不存在"}})
        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.cors()
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print(f"VECTOR backend on http://{HOST}:{PORT}")
    print(f"frontend: {FRONTEND}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
