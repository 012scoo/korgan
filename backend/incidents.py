"""Слой 3: «Первые 60 минут» — заявление о спорной операции и машина состояний инцидента."""
from __future__ import annotations

from dataclasses import dataclass, field

from .guards import Blocked

STATUS_TEXT = {
    "NEW": "Заявление принято",
    "TRIAGED": "Карточка собрана, заявление в очереди оператора",
    "FREEZE_REQUESTED": "Запрос на удержание отправлен в банк получателя через Антифрод-центр (эмуляция)",
    "HELD": "Средства удержаны на счёте получателя",
    "RETURNED": "Средства возвращены на ваш счёт",
    "RELEASED": "Удержание снято решением банка",
    "EXPIRED": "Срок удержания истёк без продления, удержание снято",
    "DISPUTE_CIVIL": "Гражданский спор: удержание не применяется",
    "CLOSED": "Заявление закрыто",
}
WHAT_TEXT = {
    "bank_call": "Звонок «из банка»",
    "police_call": "Звонок «из полиции» или госоргана",
    "investment": "Предложение инвестиций или заработка",
    "purchase": "Покупка товара или услуги",
    "other": "Другое",
}


@dataclass
class Incident:
    id: int
    op_id: int
    amount: int
    recipient_id: str
    recipient_name: str
    recipient_bank: str
    transfer_minute: float
    created_at: float
    what: str
    got_goods: bool
    status: str = "NEW"
    priority: str = "medium"
    card: dict = field(default_factory=dict)
    feed: list[dict] = field(default_factory=list)
    hold_started_at: float | None = None
    hold_until: float | None = None
    hold_max_until: float | None = None
    reply_at: float | None = None
    police_report_no: str | None = None
    recipient_explained: bool = False
    outcome: str | None = None
    frozen_at: float | None = None

    def log(self, minute: float, text: str) -> None:
        self.feed.append({"minute": round(minute, 2), "status": self.status, "text": text})

    def set(self, status: str, minute: float, text: str | None = None) -> None:
        self.status = status
        self.log(minute, text or STATUS_TEXT[status])


def is_civil_dispute(got_goods: bool, recipient: dict, cfg: dict) -> bool:
    c = cfg["incidents"]
    return (got_goods
            and not recipient.get("flagged")
            and recipient.get("history_months", 0) >= c["civil_min_history_months"]
            and recipient.get("complaints", 0) <= c["civil_max_complaints"])


def priority_for(minutes_since: float, amount: int, money_location: str) -> str:
    points = 0
    points += 2 if minutes_since <= 60 else (1 if minutes_since <= 24 * 60 else 0)
    points += 2 if amount >= 300_000 else (1 if amount >= 100_000 else 0)
    points += 2 if money_location == "in_bcc" else (1 if money_location == "other_bank" else 0)
    if points >= 5:
        return "high"
    if points >= 3:
        return "medium"
    return "low"


def police_statement(inc: Incident, client_name: str) -> str:
    return (
        f"Начальнику отдела полиции\nот {client_name}\n\nЗАЯВЛЕНИЕ\n\n"
        f"Прошу принять меры в связи с операцией, совершённой под влиянием обмана. "
        f"Обстоятельства: {WHAT_TEXT.get(inc.what, inc.what).lower()}. "
        f"Перевод на сумму {fmt_kzt(inc.amount)} получателю «{inc.recipient_name}» "
        f"({inc.recipient_bank}). Банк зарегистрировал заявление о спорной операции № {inc.id}.\n\n"
        f"Дата, подпись"
    )


def fmt_kzt(amount: int) -> str:
    return f"{amount:,}".replace(",", " ") + " ₸"


class IncidentDesk:
    def __init__(self, cfg: dict, durations):
        self.cfg = cfg
        self.d = durations

    def open(self, inc: Incident, recipient: dict, op_info: dict, now: float) -> Incident:
        inc.set("NEW", now)
        location = recipient.get("money_location", "in_bcc" if recipient.get("bank") == "BCC" else "other_bank")
        inc.priority = priority_for(now - inc.transfer_minute, inc.amount, location)
        inc.card = {
            "transfer": {"amount": inc.amount, "recipient": inc.recipient_name, "bank": inc.recipient_bank,
                         "minutes_ago": round(now - inc.transfer_minute, 1)},
            "device": op_info.get("device", {}),
            "score": op_info.get("score"),
            "zone": op_info.get("zone"),
            "reasons": op_info.get("reasons", []),
            "recipient": {"history_months": recipient.get("history_months"),
                          "complaints": recipient.get("complaints", 0),
                          "flagged": bool(recipient.get("flagged")),
                          "money_location": location},
            "chain": recipient.get("chain", []),
            "what": WHAT_TEXT.get(inc.what, inc.what),
            "got_goods": inc.got_goods,
        }
        if is_civil_dispute(inc.got_goods, recipient, self.cfg):
            inc.set("DISPUTE_CIVIL", now,
                    "Вы получили товар, а у получателя долгая история без жалоб. Банк не может вернуть деньги "
                    "по желанию одной стороны: это гражданский спор. Направьте продавцу письменную претензию; "
                    "если он не ответит, обратитесь в органы по защите прав потребителей или в суд.")
            return inc
        inc.set("TRIAGED", now)
        return inc

    def act(self, inc: Incident, action: str, now: float, police_report_no: str | None = None) -> str:
        if action == "freeze":
            if inc.status != "TRIAGED":
                raise Blocked("BAD_STATE", "Удержание можно запросить только для заявления в очереди.")
            if inc.recipient_bank == "BCC":
                self._hold(inc, now, "Средства удержаны на счёте получателя в BCC.")
            else:
                inc.reply_at = now + self.cfg["incidents"]["antifraud_reply_minutes"]
                inc.set("FREEZE_REQUESTED", now)
            return inc.status
        if action == "extend":
            if inc.status != "HELD":
                raise Blocked("BAD_STATE", "Продлить можно только действующее удержание.")
            if not police_report_no:
                raise Blocked("POLICE_REPORT_REQUIRED", "Для продления нужен номер заявления в полиции.", 400)
            if inc.hold_until >= inc.hold_max_until:
                raise Blocked("HOLD_LIMIT", "Достигнут предельный срок удержания (R0.7).")
            inc.police_report_no = police_report_no
            inc.hold_until = min(inc.hold_until + self.d.initial_hold(), inc.hold_max_until)
            inc.log(now, f"Удержание продлено по заявлению в полицию № {police_report_no}.")
            return inc.status
        if action == "explained":
            if inc.status not in ("HELD", "FREEZE_REQUESTED"):
                raise Blocked("BAD_STATE", "Пояснения принимаются при действующем удержании.")
            inc.recipient_explained = True
            inc.log(now, "Получатель уведомлён о причинах и дал пояснения. Решение за оператором.")
            return inc.status
        if action == "return":
            if inc.status != "HELD":
                raise Blocked("BAD_STATE", "Вернуть можно только удержанные средства.")
            inc.outcome = "returned"
            inc.set("RETURNED", now)
            return inc.status
        if action == "release":
            if inc.status != "HELD":
                raise Blocked("BAD_STATE", "Снять можно только действующее удержание.")
            inc.outcome = "released"
            inc.set("RELEASED", now)
            return inc.status
        if action == "close":
            if inc.status not in ("RETURNED", "RELEASED", "EXPIRED", "DISPUTE_CIVIL"):
                raise Blocked("BAD_STATE", "Закрыть можно после решения по удержанию.")
            if inc.outcome is None:
                inc.outcome = "civil" if inc.status == "DISPUTE_CIVIL" else "not_returned"
            inc.set("CLOSED", now, f"Заявление закрыто. Итог: {OUTCOME_TEXT[inc.outcome]}.")
            return inc.status
        raise Blocked("BAD_ACTION", f"Неизвестное действие {action}.", 400)

    def tick(self, inc: Incident, now: float) -> None:
        if inc.status == "FREEZE_REQUESTED" and inc.reply_at is not None and now >= inc.reply_at:
            self._hold(inc, now, "Ответ Антифрод-центра (эмуляция): банк получателя удержал средства.")
        elif inc.status == "HELD" and inc.hold_until is not None and now >= inc.hold_until:
            inc.outcome = "not_returned"
            inc.set("EXPIRED", now)

    def _hold(self, inc: Incident, now: float, text: str) -> None:
        inc.hold_started_at = now
        inc.frozen_at = now
        inc.hold_max_until = self.d.max_hold_until(now)
        inc.hold_until = min(now + self.d.initial_hold(), inc.hold_max_until)
        inc.set("HELD", now, text)
        inc.log(now, "Банк получателя уведомляет его о причинах удержания; получатель вправе дать пояснения.")


OUTCOME_TEXT = {
    "returned": "средства удержаны и возвращены",
    "released": "удержание снято, вернуть не удалось",
    "not_returned": "вернуть не удалось",
    "civil": "гражданский спор, удержание не применялось",
}
