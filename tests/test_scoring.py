import pytest

from backend.scoring import Signals, score, zone_for


def codes(res):
    return {r.code for r in res.reasons}


@pytest.mark.parametrize("field,code,points", [
    ("new_recipient", "new_recipient", 25),
    ("flagged_recipient", "flagged_recipient", 30),
    ("night", "night", 15),
    ("new_device", "new_device", 10),
])
def test_each_boolean_signal(cfg, field, code, points):
    res = score(Signals(amount=1000, **{field: True}), cfg)
    assert codes(res) == {code}
    assert res.score == points


def test_call_signals(cfg):
    assert score(Signals(amount=1000, call="unknown"), cfg).score == 35
    assert score(Signals(amount=1000, call="known"), cfg).score == 5
    assert score(Signals(amount=1000, call="none"), cfg).score == 0


def test_amount_signals_do_not_stack(cfg):
    huge = score(Signals(amount=200_000), cfg)        # ровно 5× обычной
    assert codes(huge) == {"huge_amount"} and huge.score == 25
    large = score(Signals(amount=100_000), cfg)       # крупная, но < 5×
    assert codes(large) == {"large_amount"} and large.score == 10
    small = score(Signals(amount=99_999), cfg)
    assert small.score == 0


def test_negative_signals_and_clamp_at_zero(cfg):
    res = score(Signals(amount=3500, whitelisted=True, big_purchase=True), cfg)
    assert res.raw == -50
    assert res.score == 0 and res.zone == "green"


def test_clamp_at_100_scenario_2(cfg):
    res = score(Signals(amount=480_000, new_recipient=True, flagged_recipient=True, call="unknown"), cfg)
    assert res.raw == 115
    assert res.score == 100 and res.zone == "red"


def test_scenario_3_is_yellow_on_boundary(cfg):
    res = score(Signals(amount=480_000, new_recipient=True, big_purchase=True), cfg)
    assert res.score == 30 and res.zone == "yellow"


@pytest.mark.parametrize("value,zone", [(0, "green"), (29, "green"), (30, "yellow"),
                                        (69, "yellow"), (70, "red"), (100, "red")])
def test_zone_boundaries(cfg, value, zone):
    assert zone_for(value, cfg) == zone


def test_reasons_are_human_readable(cfg):
    res = score(Signals(amount=480_000, new_recipient=True), cfg)
    texts = [r.text for r in res.reasons]
    assert "Сумма в 12 раз больше обычной" in texts
    assert all(t and t[0].isupper() for t in texts)


def test_points_come_from_config(cfg):
    cfg["scoring"]["points"]["night"] = 40
    assert score(Signals(amount=1000, night=True), cfg).score == 40
