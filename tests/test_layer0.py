"""Слой 0: R0.1–R0.7."""
import pytest

from backend.engine import Engine
from backend.guards import Blocked


def test_r01_any_call_blocks_transfer(engine):
    engine.set_sim(call="active_known")
    with pytest.raises(Blocked) as e:
        engine.create_transfer("utility", 3500)         # даже белый список и балл 0
    assert e.value.code == "CALL_ACTIVE"
    assert engine.ops == []
    assert engine.counters["call_blocks"] == 1


def test_r01_call_blocks_credit_too(engine):
    engine.set_sim(call="active_unknown")
    with pytest.raises(Blocked) as e:
        engine.create_credit(300_000)
    assert e.value.code == "CALL_ACTIVE"


def test_r02_recent_call_counts_in_scoring(engine):
    engine.set_sim(call="active_unknown")
    engine.set_sim(call="none")                 # система сама фиксирует завершение
    engine.advance(3)
    op = engine.create_transfer("repair", 10_000)
    assert any(r["code"] == "call_unknown" for r in op.reasons)


def test_r02_window_expires(engine, cfg):
    engine.set_sim(call="ended_unknown")
    engine.advance(cfg["protection"]["recent_call_window_minutes"] + 0.5)
    op = engine.create_transfer("repair", 10_000)
    assert not any(r["code"].startswith("call") for r in op.reasons)


def test_r03_remote_access_blocks_money_and_disable(engine):
    engine.set_sim(remote_access=True)
    with pytest.raises(Blocked) as e:
        engine.create_transfer("utility", 3500)
    assert e.value.code == "REMOTE_ACCESS"
    with pytest.raises(Blocked) as e2:
        engine.set_protection(False)
    assert e2.value.code == "REMOTE_ACCESS"


def test_r04_credit_lock_independent_of_scoring(engine):
    engine.set_credit_lock(True)
    with pytest.raises(Blocked) as e:
        engine.create_credit(1000)                      # балл был бы 0
    assert e.value.code == "CREDIT_LOCK"
    assert engine.counters["credit_lock_blocks"] == 1


def test_r05_scoring_failure_goes_yellow(cfg):
    def broken(*_):
        raise RuntimeError("scoring down")
    eng = Engine(cfg, scorer=broken)
    op = eng.create_transfer("utility", 3500)
    assert op.zone == "yellow" and op.status == "HELD" and op.scoring_failed
    assert eng.audit.count("scoring_failed") == 1
    assert op.hold_deadline is not None                 # не вечная блокировка


def test_r06_disable_has_cooldown_and_notifies(real_cfg):
    eng = Engine(real_cfg)
    req = eng.set_protection(False)
    assert req["status"] == "pending"
    assert req["effective_at"] - req["requested_at"] == 24 * 60
    assert eng.ward["protection_on"] is True
    assert any("отключение" in n["text"] for n in eng.notifications)
    eng.advance(24 * 60 - 1)
    assert eng.ward["protection_on"] is True
    eng.advance(1)
    assert eng.ward["protection_on"] is False


def test_r06_disable_refused_on_call_and_new_device(engine):
    engine.set_credit_lock(True)
    engine.set_sim(call="active_unknown")
    with pytest.raises(Blocked) as e:
        engine.set_credit_lock(False)
    assert e.value.code == "CALL_ACTIVE"
    engine.set_sim(call="none", new_device=True)
    with pytest.raises(Blocked) as e2:
        engine.set_protection(False)
    assert e2.value.code == "NEW_DEVICE"


def test_r06_ward_can_cancel_disable(engine):
    req = engine.set_protection(False)
    engine.cancel_disable(req["id"])
    engine.advance(100)
    assert engine.ward["protection_on"] is True


def test_r07_hold_expires_and_money_stays(engine):
    op = engine.create_transfer("repair", 120_000)
    assert op.status == "HELD"
    balance = engine.ward["balance"]
    engine.advance_to(op.hold_deadline + 0.1, step=5)
    assert op.status == "EXPIRED"
    assert engine.ward["balance"] == balance


def test_r07_real_limit_is_five_working_days(real_cfg):
    from backend.config import Durations
    d = Durations(real_cfg)
    # старт: среда 18.11.2026 10:00 → +5 рабочих дней = среда 25.11.2026 10:00 (7 календарных)
    assert d.max_hold_until(0) == 7 * 24 * 60


def test_protection_off_skips_layer0_call_block(engine):
    engine.ward["protection_on"] = False
    engine.set_sim(call="active_unknown")
    op = engine.create_transfer("utility", 3500)
    assert op.status == "EXECUTED"
