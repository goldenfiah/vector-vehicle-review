"""API smoke tests for the VECTOR backend. Run while server.py is on :8100."""
import json
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8100"


def call(path, method="GET", payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = Request(BASE + path, data=data, method=method,
                  headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=5) as res:
            return res.status, json.loads(res.read().decode())
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


class ApiTest(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parent.parent
        subprocess.run([sys.executable, str(root / "database" / "build_db.py")], check=True, capture_output=True)

    def test_health(self):
        status, body = call("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

    def test_project_and_detections(self):
        status, project = call("/api/projects/yard-a")
        self.assertEqual(status, 200)
        self.assertEqual(project["counts"]["total"], 9)
        status, dets = call("/api/projects/yard-a/detections")
        self.assertEqual(status, 200)
        self.assertEqual(len(dets["items"]), 9)
        self.assertTrue(all(len(d["polygon"]) >= 3 for d in dets["items"]))

    def test_patch_and_version(self):
        status, body = call("/api/detections/1", "PATCH", {"state": "confirmed"})
        self.assertEqual(status, 200)
        self.assertEqual(body["state"], "confirmed")
        status, version = call("/api/projects/yard-a/versions", "POST",
                               {"label": "测试修订", "author": "test"})
        self.assertEqual(status, 201)
        self.assertIn("id", version)
        status, versions = call("/api/projects/yard-a/versions")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(versions["items"]), 2)

    def test_add_detection(self):
        status, body = call("/api/projects/yard-a/detections", "POST", {
            "polygon": [[100, 100], [200, 100], [200, 160], [100, 160]],
            "label": "car", "score": 0.7
        })
        self.assertEqual(status, 201)
        self.assertEqual(body["origin"], "ai")
        self.assertEqual(body["label"], "car")

    def test_bad_state(self):
        status, body = call("/api/detections/2", "PATCH", {"state": "not-a-state"})
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "BAD_STATE")

    def test_missing_detection(self):
        status, body = call("/api/detections/9999", "PATCH", {"state": "confirmed"})
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main(verbosity=2)
