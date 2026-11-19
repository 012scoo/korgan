"""Общие тест-векторы: тот же файл проверяет JS-движок (standalone/engine.test.js).
Если оба прогона зелёные, движки принимают одинаковые решения."""
import json
from pathlib import Path

import pytest

from backend.guards import Blocked
from backend.scoring import Signals, score

V = json.loads((Path(__file__).parent / "vectors" / "vectors.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("v", V["scoring"], ids=[v["name"] for v in V["scoring"]])
def test_scoring_vector(v, cfg):
    r = score(Signals(**v["signals"]), cfg)
    assert r.score == v["expected"]["score"]
    assert r.zone == v["expected"]["zone"]
    assert [x.code for x in r.reasons] == v["expected"]["codes"]


@pytest.mark.parametrize("v", V["ladder"], ids=[v["name"] for v in V["ladder"]])
def test_ladder_vector(v, engine):
    engine.reset(v["scenario"])
    op = None
    for s in v["steps"]:
        if "expect" in s:
            x = s["expect"]
            if "zone" in x:
                assert op.zone == x["zone"]
            if "status" in x:
                assert op.status == x["status"]
            if "decided_by" in x:
                assert op.decided_by == x["decided_by"]
            for a in x.get("notified", []):
                assert a in op.notified, a
            for a in x.get("not_notified", []):
                assert a not in op.notified, a
            continue
        try:
            if s["do"] == "busy":
                engine.set_busy(guardian=s["guardian"], second=s["second"])
            elif s["do"] == "sim":
                engine.set_sim(call=s["call"])
            elif s["do"] == "transfer":
                op = engine.create_transfer(s["rid"], s["amount"], big_purchase=s.get("big", False))
            elif s["do"] == "advance_to":
                engine.advance_to(s["minute"])
            elif s["do"] == "decide":
                r = engine.decide(op.id, s["actor"], s["decision"], called=s.get("called"))
                if "result" in s:
                    assert r["result"] == s["result"]
            assert "error" not in s, f"ожидалась ошибка {s.get('error')}"
        except Blocked as e:
            assert e.code == s.get("error"), e.code
