"""Слой 3 и аудит."""
import pytest

from backend.guards import Blocked


def test_civil_dispute_no_freeze(engine):
    engine.reset(7)
    op = engine.ops[0]
    res = engine.report_fraud(op.id, "purchase", got_goods=True)
    inc = engine.incidents[0]
    assert res["status"] == "DISPUTE_CIVIL"
    assert inc.hold_until is None
    with pytest.raises(Blocked):
        engine.incident_action(inc.id, "freeze")


def test_fraud_report_autoprotects_and_holds_in_bcc(engine):
    engine.reset(6)
    op = engine.ops[0]
    engine.report_fraud(op.id, "bank_call", got_goods=False)
    w = engine.ward
    assert w["outgoing_blocked"] and w["cards_blocked"] and w["credit_lock"] and w["sessions_reset"] == 1
    inc = engine.incidents[0]
    assert inc.status == "TRIAGED" and inc.priority == "high"
    engine.incident_action(inc.id, "freeze")
    assert inc.status == "HELD"
    assert engine.stats()["time_to_freeze_minutes"] == 20.0


def test_other_bank_goes_through_antifraud(engine, cfg):
    engine.reset(6)
    engine.recipients["receiver_bcc"]["bank"] = "Другой банк"
    engine.recipients["receiver_bcc"]["money_location"] = "other_bank"
    engine.report_fraud(engine.ops[0].id, "bank_call", got_goods=False)
    inc = engine.incidents[0]
    engine.incident_action(inc.id, "freeze")
    assert inc.status == "FREEZE_REQUESTED"
    engine.advance(cfg["incidents"]["antifraud_reply_minutes"])
    assert inc.status == "HELD"


def test_extension_needs_police_report_and_respects_limit(engine):
    engine.reset(6)
    engine.report_fraud(engine.ops[0].id, "bank_call", got_goods=False)
    inc = engine.incidents[0]
    engine.incident_action(inc.id, "freeze")
    with pytest.raises(Blocked) as e:
        engine.incident_action(inc.id, "extend")
    assert e.value.code == "POLICE_REPORT_REQUIRED"
    engine.incident_action(inc.id, "extend", police_report_no="КУИ-123")
    engine.incident_action(inc.id, "extend", police_report_no="КУИ-123")
    assert inc.hold_until == inc.hold_max_until          # не дольше R0.7
    with pytest.raises(Blocked) as e2:
        engine.incident_action(inc.id, "extend", police_report_no="КУИ-123")
    assert e2.value.code == "HOLD_LIMIT"


def test_hold_auto_expires_without_extension(engine):
    engine.reset(6)
    engine.report_fraud(engine.ops[0].id, "bank_call", got_goods=False)
    inc = engine.incidents[0]
    engine.incident_action(inc.id, "freeze")
    engine.advance(inc.hold_until - engine.now + 0.1)
    assert inc.status == "EXPIRED"


def test_return_and_close_flags_recipient(engine):
    engine.reset(6)
    balance = engine.ward["balance"]
    engine.report_fraud(engine.ops[0].id, "bank_call", got_goods=False)
    inc = engine.incidents[0]
    engine.incident_action(inc.id, "freeze")
    engine.incident_action(inc.id, "explained")
    engine.incident_action(inc.id, "return")
    engine.incident_action(inc.id, "close")
    assert inc.status == "CLOSED" and engine.ward["balance"] == balance + 480_000
    assert engine.recipients["receiver_bcc"]["flagged"] is True


def test_outgoing_blocked_after_report(engine):
    engine.reset(7)
    engine.report_fraud(engine.ops[0].id, "purchase", got_goods=True)
    with pytest.raises(Blocked) as e:
        engine.create_transfer("utility", 3500)
    assert e.value.code == "OUTGOING_BLOCKED"


def test_audit_hash_chain_detects_tampering(engine):
    op = engine.create_transfer("repair", 120_000)
    engine.decide(op.id, "guardian", "reject")
    assert engine.audit.verify()["ok"] is True
    engine.conn.execute("UPDATE audit SET actor = 'guardian' WHERE action = 'held'")
    engine.conn.commit()
    res = engine.audit.verify()
    assert res["ok"] is False and res["broken_at"] is not None
