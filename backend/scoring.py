"""Слой 1: скоринг риска 0–100 на правилах. Все числа берутся из config.yaml."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Signals:
    amount: int
    new_recipient: bool = False
    flagged_recipient: bool = False
    whitelisted: bool = False
    call: str = "none"          # действующий звонок с учётом окна R0.2: none | known | unknown
    night: bool = False
    new_device: bool = False
    big_purchase: bool = False


@dataclass
class Reason:
    code: str
    text: str
    points: int

    def as_dict(self) -> dict:
        return {"code": self.code, "text": self.text, "points": self.points}


@dataclass
class ScoreResult:
    score: int
    zone: str                    # green | yellow | red
    reasons: list[Reason] = field(default_factory=list)
    raw: int = 0
    failed: bool = False

    def reasons_dicts(self) -> list[dict]:
        return [r.as_dict() for r in self.reasons]


def zone_for(score: int, cfg: dict) -> str:
    zones = cfg["scoring"]["zones"]
    if score >= zones["red_from"]:
        return "red"
    if score >= zones["yellow_from"]:
        return "yellow"
    return "green"


def score(sig: Signals, cfg: dict) -> ScoreResult:
    sc = cfg["scoring"]
    pts = sc["points"]
    reasons: list[Reason] = []

    def add(code: str, text: str) -> None:
        reasons.append(Reason(code, text, int(pts[code])))

    if sig.new_recipient:
        add("new_recipient", "Новый получатель: раньше переводов ему не было")
    if sig.flagged_recipient:
        add("flagged_recipient", "Получатель есть в базе подозрительных счетов банка")

    typical = sc["typical_amount"]
    ratio = sig.amount / typical if typical else 0
    if ratio >= sc["huge_multiplier"]:
        reasons.append(Reason("huge_amount", f"Сумма в {round(ratio)} раз больше обычной", int(pts["huge_amount"])))
    elif sig.amount >= sc["large_amount"]:
        add("large_amount", "Крупная сумма")

    if sig.call == "unknown":
        add("call_unknown", "Звонок с незнакомого номера во время операции или незадолго до неё")
    elif sig.call == "known":
        add("call_known", "Звонок знакомого во время операции или незадолго до неё")

    if sig.night:
        add("night", "Ночное время")
    if sig.new_device:
        add("new_device", "Новое устройство")
    if sig.whitelisted:
        add("whitelist", "Получатель из белого списка")
    if sig.big_purchase:
        add("big_purchase", "Включён режим «Я совершаю крупную покупку»")

    raw = sum(r.points for r in reasons)
    clamped = max(0, min(100, raw))
    return ScoreResult(score=clamped, zone=zone_for(clamped, cfg), reasons=reasons, raw=raw)
