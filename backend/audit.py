"""Журнал решений в SQLite с цепочкой хэшей: каждая запись хранит хэш предыдущей."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading

GENESIS = "0" * 64


class AuditLog:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.lock = threading.Lock()
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, minute REAL, actor TEXT, action TEXT,"
            " payload TEXT, prev_hash TEXT, hash TEXT)"
        )
        conn.commit()

    @staticmethod
    def _digest(prev_hash: str, minute: float, actor: str, action: str, payload: str) -> str:
        body = json.dumps([prev_hash, round(minute, 4), actor, action, payload], ensure_ascii=False)
        return hashlib.sha256(body.encode("utf-8")).hexdigest()

    def last_hash(self) -> str:
        row = self.conn.execute("SELECT hash FROM audit ORDER BY id DESC LIMIT 1").fetchone()
        return row[0] if row else GENESIS

    def append(self, minute: float, actor: str, action: str, payload: dict | None = None) -> dict:
        with self.lock:
            data = json.dumps(payload or {}, ensure_ascii=False, sort_keys=True)
            prev = self.last_hash()
            h = self._digest(prev, minute, actor, action, data)
            cur = self.conn.execute(
                "INSERT INTO audit (minute, actor, action, payload, prev_hash, hash) VALUES (?,?,?,?,?,?)",
                (minute, actor, action, data, prev, h),
            )
            self.conn.commit()
            return {"id": cur.lastrowid, "minute": minute, "actor": actor, "action": action,
                    "payload": payload or {}, "hash": h}

    def tail(self, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, minute, actor, action, payload, hash FROM audit ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [{"id": r[0], "minute": r[1], "actor": r[2], "action": r[3],
                 "payload": json.loads(r[4]), "hash": r[5]} for r in rows]

    def count(self, action: str | None = None) -> int:
        if action:
            return self.conn.execute("SELECT COUNT(*) FROM audit WHERE action = ?", (action,)).fetchone()[0]
        return self.conn.execute("SELECT COUNT(*) FROM audit").fetchone()[0]

    def verify(self) -> dict:
        prev = GENESIS
        rows = self.conn.execute(
            "SELECT id, minute, actor, action, payload, prev_hash, hash FROM audit ORDER BY id"
        ).fetchall()
        for r in rows:
            if r[5] != prev or self._digest(prev, r[1], r[2], r[3], r[4]) != r[6]:
                return {"ok": False, "broken_at": r[0], "records": len(rows)}
            prev = r[6]
        return {"ok": True, "broken_at": None, "records": len(rows)}

    def clear(self) -> None:
        with self.lock:
            self.conn.execute("DELETE FROM audit")
            self.conn.execute("DELETE FROM sqlite_sequence WHERE name = 'audit'")
            self.conn.commit()
