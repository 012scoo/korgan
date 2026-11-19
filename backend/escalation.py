"""Слой 2: лестница подтверждения и правила решений."""
from __future__ import annotations

from dataclasses import dataclass, field

from .guards import Blocked

ACTOR_LABELS = {
    "guardian": "опекун",
    "second": "второй доверенный",
    "ward": "подопечный",
    "operator": "оператор банка",
}
TRUSTED = ("guardian", "second")


@dataclass
class Operation:
    id: int
    kind: str                     # transfer | credit
    amount: int
    recipient_id: str
    recipient_name: str
    created_at: float
    score: int = 0
    zone: str = "green"
    reasons: list[dict] = field(default_factory=list)
    device: dict = field(default_factory=dict)
    status: str = "HELD"          # HELD | EXECUTED | REJECTED | EXPIRED
    notified: dict = field(default_factory=dict)        # actor -> минута получения запроса
    approvals: dict = field(default_factory=dict)       # actor -> минута одобрения
    first_trusted_approval_at: float | None = None
    attempts: dict = field(default_factory=dict)
    decided_by: str | None = None
    decided_at: float | None = None
    hold_deadline: float | None = None
    big_purchase: bool = False
    scoring_failed: bool = False
    called_answer: bool | None = None
    events: list[dict] = field(default_factory=list)

    def event(self, minute: float, text: str) -> None:
        self.events.append({"minute": round(minute, 2), "text": text})

    @property
    def held(self) -> bool:
        return self.status == "HELD"


class Ladder:
    def __init__(self, cfg: dict):
        self.cfg = cfg["escalation"]

    # --- времена ---------------------------------------------------------
    def self_confirm_allowed(self, op: Operation) -> bool:
        # Самоподтверждения нет: мошенник рядом или на телефоне продиктует «никто не звонил».
        # Если близкие молчат, решает сотрудник банка, иначе операция отменяется по предельному сроку.
        return False

    def operator_due(self, op: Operation) -> float:
        due = op.created_at + self.cfg["operator_after_minutes"]
        if op.zone == "red" and op.first_trusted_approval_at is not None:
            due = min(due, op.first_trusted_approval_at + self.cfg["operator_after_first_trusted_approval_minutes"])
        return due

    def start(self, op: Operation, now: float) -> list[str]:
        op.notified["guardian"] = now
        op.event(now, "Операция на паузе. Запрос отправлен опекуну.")
        return ["guardian"]

    def tick(self, op: Operation, now: float) -> list[str]:
        """Продвигает лестницу. Возвращает список участников, получивших запрос на этом шаге."""
        if not op.held:
            return []
        newly: list[str] = []
        rel = now - op.created_at
        if "second" not in op.notified and rel >= self.cfg["second_after_minutes"]:
            op.notified["second"] = now
            op.event(now, "Опекун не ответил. Запрос отправлен второму доверенному.")
            newly.append("second")
        if "operator" not in op.notified and now >= self.operator_due(op):
            op.notified["operator"] = now
            op.event(now, "Подключён оператор банка: карточка риска в очереди.")
            newly.append("operator")
        return newly

    # --- решения ---------------------------------------------------------
    def decide(self, op: Operation, actor: str, decision: str, now: float,
               called: bool | None = None) -> str:
        """Возвращает итог: approved | rejected | waiting | escalated_red. Бросает Blocked."""
        if decision not in ("approve", "reject"):
            raise Blocked("BAD_DECISION", "Решение должно быть approve или reject.", 400)
        if not op.held:
            raise Blocked("NOT_PENDING", "По этой операции решение уже принято.", 409)

        op.attempts[actor] = op.attempts.get(actor, 0) + 1
        if op.attempts[actor] > self.cfg["max_decision_attempts"]:
            raise Blocked("TOO_MANY_ATTEMPTS", "Слишком много попыток подтверждения по этой операции.", 429)

        label = ACTOR_LABELS.get(actor, actor)

        # Подопечный всегда может отменить свою операцию.
        if decision == "reject" and actor == "ward":
            self._finish(op, "REJECTED", actor, now, "Подопечный отменил операцию.")
            return "rejected"

        if actor == "ward":
            raise Blocked("SELF_CONFIRM_UNAVAILABLE",
                          "Подтвердить операцию самому нельзя: её подтверждают близкие или сотрудник банка.", 403)

        if actor not in op.notified:
            raise Blocked("NOT_YOUR_TURN", "Запрос этому участнику ещё не поступал.", 403)

        if decision == "reject":
            self._finish(op, "REJECTED", actor, now, f"Отклонил {label}. Операция остановлена.")
            return "rejected"

        # --- approve ---
        if op.zone == "yellow" or actor == "operator":
            text = ("Оператор проверил личность и разрешил операцию." if actor == "operator"
                    else f"Разрешил {label}.")
            self._finish(op, "EXECUTED", actor, now, text)
            return "approved"

        # Красная зона: нужен второй доверенный или оператор.
        op.approvals[actor] = now
        others = [a for a in TRUSTED if a != actor]
        if any(a in op.approvals for a in others):
            self._finish(op, "EXECUTED", actor, now, "Оба доверенных подтвердили операцию.")
            return "approved"
        if op.first_trusted_approval_at is None:
            op.first_trusted_approval_at = now
        op.event(now, f"Разрешил {label}. Красная зона: нужно второе подтверждение.")
        for other in others:
            if other not in op.notified:
                op.notified[other] = now
                op.event(now, f"Запрос сразу отправлен: {ACTOR_LABELS[other]}.")
        return "waiting"

    def expire(self, op: Operation, now: float) -> bool:
        """R0.7: удержание не дольше предельного срока. Деньги остаются у клиента."""
        if op.held and op.hold_deadline is not None and now >= op.hold_deadline:
            self._finish(op, "EXPIRED", "system", now,
                         "Истёк предельный срок удержания. Операция не проведена, деньги на счёте.")
            return True
        return False

    @staticmethod
    def _finish(op: Operation, status: str, actor: str, now: float, text: str) -> None:
        op.status = status
        op.decided_by = actor
        op.decided_at = now
        op.event(now, text)
