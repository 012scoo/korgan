"""Слой 2: лестница и правила решений."""
import pytest

from backend.guards import Blocked


def red_op(engine):
    engine.set_sim(call="ended_unknown")
    return engine.create_transfer("stranger", 480_000)


def test_ladder_timing_yellow(engine):
    op = engine.create_transfer("repair", 120_000)      # 35, жёлтая
    assert set(op.notified) == {"guardian"}
    engine.advance_to(5)
    assert "second" in op.notified
    engine.advance_to(10)
    assert "ward" not in op.notified                    # самоподтверждения нет
    engine.advance_to(15)
    assert "operator" in op.notified


def test_single_reject_stops_immediately(engine):
    op = red_op(engine)
    engine.decide(op.id, "guardian", "approve")
    engine.decide(op.id, "second", "reject")
    assert op.status == "REJECTED"


def test_red_needs_second_confirmation(engine):
    op = red_op(engine)
    assert op.zone == "red"
    res = engine.decide(op.id, "guardian", "approve")
    assert res["result"] == "waiting" and op.status == "HELD"
    assert "second" in op.notified                      # ушёл сразу, не ждём 5 минут
    engine.decide(op.id, "second", "approve")
    assert op.status == "EXECUTED"


def test_red_operator_after_silence_of_second(engine):
    op = red_op(engine)
    engine.advance(2)
    engine.decide(op.id, "guardian", "approve")
    engine.advance_to(6.5)
    assert "operator" not in op.notified
    engine.advance_to(7)
    assert "operator" in op.notified                    # 2 + 5 минут, раньше обычной 15-й
    engine.decide(op.id, "operator", "approve")
    assert op.status == "EXECUTED"


def test_yellow_single_approve_is_enough(engine):
    op = engine.create_transfer("repair", 120_000)
    engine.decide(op.id, "guardian", "approve")
    assert op.status == "EXECUTED"


def test_no_self_confirm_ever(engine):
    """В средней зоне при молчании близких решает сотрудник, иначе отмена. Клиент сам не проводит."""
    for rid, amount, big in (("repair", 120_000, False), ("shop", 480_000, True)):
        engine.reset(3)
        op = engine.create_transfer(rid, amount, big_purchase=big)
        assert op.zone == "yellow"
        engine.advance_to(12)
        assert "ward" not in op.notified
        for called in (False, True, None):
            with pytest.raises(Blocked) as e:
                engine.decide(op.id, "ward", "approve", called=called)
            assert e.value.code == "SELF_CONFIRM_UNAVAILABLE"
        engine.advance_to(61)
        assert op.status == "EXPIRED"


def test_not_your_turn(engine):
    op = engine.create_transfer("repair", 120_000)
    with pytest.raises(Blocked) as e:
        engine.decide(op.id, "operator", "approve")
    assert e.value.code == "NOT_YOUR_TURN"


def test_attempt_limit(engine, cfg):
    op = engine.create_transfer("repair", 120_000)
    limit = cfg["escalation"]["max_decision_attempts"]
    for _ in range(limit):
        with pytest.raises(Blocked):
            engine.decide(op.id, "operator", "approve")
    with pytest.raises(Blocked) as e:
        engine.decide(op.id, "operator", "approve")
    assert e.value.code == "TOO_MANY_ATTEMPTS" and e.value.status == 429


def test_guardian_view_hides_balance_and_history(engine):
    engine.create_transfer("repair", 120_000)
    view = engine.view_trusted("guardian")
    flat = repr(view)
    assert "balance" not in flat and "history" not in flat
    assert view["requests"][0]["amount"] == 120_000
    assert view["requests"][0]["reasons"]
