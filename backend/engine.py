"""Движок «Қорған»: состояние, операции, слои 0–3, сценарии и представления по ролям.

Время — «минуты сценария» (self.now). В приложении его двигает фоновый таск,
в тестах — вызовы advance().
"""
from __future__ import annotations

import copy
import json
import sqlite3
import threading
from dataclasses import asdict

from . import guards
from .audit import AuditLog
from .config import Durations
from .escalation import ACTOR_LABELS, Ladder, Operation
from .guards import Blocked, SimState
from .incidents import STATUS_TEXT, Incident, IncidentDesk, OUTCOME_TEXT, fmt_kzt, police_statement
from .scoring import Signals, score as default_score

BASE_RECIPIENTS = {
    "utility": {"name": "Алматы Су (коммуналка)", "bank": "BCC", "known": True, "flagged": False,
                "history_months": 240, "complaints": 0},
    "grandson": {"name": "Алибек, внук", "bank": "BCC", "known": True, "flagged": False,
                 "history_months": 60, "complaints": 0},
    "shop": {"name": "Мебель Плюс", "bank": "Другой банк", "known": False, "flagged": False,
             "history_months": 36, "complaints": 0},
    "repair": {"name": "ИП «Ремонт под ключ»", "bank": "Другой банк", "known": False, "flagged": False,
               "history_months": 24, "complaints": 0},
    "stranger": {"name": "Иванов С. Н. ••4821", "bank": "Другой банк", "known": False, "flagged": True,
                 "history_months": 1, "complaints": 4},
    "receiver_bcc": {"name": "Сейткали Д. ••7710", "bank": "BCC", "known": False, "flagged": False,
                     "history_months": 0.5, "complaints": 2, "money_location": "in_bcc",
                     "chain": [
                         {"to": "Счёт ••2291 в BCC", "amount": 300_000, "kind": "transfer", "visible": True},
                         {"to": "Счёт в другом банке", "amount": 120_000, "kind": "transfer", "visible": False},
                         {"to": "Снятие наличных, банкомат, Алматы", "amount": 60_000, "kind": "cash", "visible": True},
                     ]},
    "seller": {"name": "Ержан К., частный продавец", "bank": "BCC", "known": False, "flagged": False,
               "history_months": 48, "complaints": 0},
}
GUARDIAN_PEOPLE = {
    "alibek": {"name": "Алибек", "relation": "внук", "acc": "Алибека"},
    "aigul": {"name": "Айгуль", "relation": "тётя", "acc": "Айгуль"},
}

SCENARIOS = {
    1: {"title": "Коммуналка на белый список",
        "hint": "Нажмите «Перевести»: балл 0, перевод проходит сразу.",
        "form": {"kind": "transfer", "recipient_id": "utility", "amount": 3500, "big_purchase": False}},
    2: {"title": "Звонок мошенника и коучинг",
        "hint": "Шаг 1: переведите во время звонка — сработает блокировка. Шаг 2: в имитации выберите «Звонка нет» "
                "(дед положил трубку) и переведите снова — красная зона, опекун отклоняет.",
        "form": {"kind": "transfer", "recipient_id": "stranger", "amount": 480000, "big_purchase": False}},
    3: {"title": "Реальная покупка, близкие заняты",
        "hint": "Переведите: жёлтая зона. Опекуны не отвечают, самоподтверждение недоступно (сумма выше лимита), "
                "на 15-й минуте решает оператор.",
        "form": {"kind": "transfer", "recipient_id": "shop", "amount": 480000, "big_purchase": True}},
    4: {"title": "Спорный перевод, подтверждаю сам",
        "hint": "Переведите: жёлтая зона, балл 35. На 10-й минуте подтвердите сам и ответьте на вопрос о звонке.",
        "form": {"kind": "transfer", "recipient_id": "repair", "amount": 120000, "big_purchase": False}},
    5: {"title": "Кредитный замок",
        "hint": "Оформите рассрочку — замок блокирует. Затем запросите снятие замка: охлаждение, опекуны уведомлены.",
        "form": {"kind": "credit", "amount": 300000}},
    6: {"title": "Первые 60 минут",
        "hint": "20 минут назад ушёл перевод 480 000 ₸ (защита ещё не была подключена). Нажмите «Меня обманули».",
        "form": {"kind": "transfer", "recipient_id": "utility", "amount": 3500, "big_purchase": False}},
    7: {"title": "Спорный товар",
        "hint": "Нажмите «Меня обманули», причина «покупка», ответ «товар получил»: заморозки нет.",
        "form": {"kind": "transfer", "recipient_id": "utility", "amount": 3500, "big_purchase": False}},
}


class Engine:
    def __init__(self, cfg: dict, db_path: str = ":memory:", scorer=None):
        self.cfg = cfg
        self.d = Durations(cfg)
        self.ladder = Ladder(cfg)
        self.desk = IncidentDesk(cfg, self.d)
        self.scorer = scorer or default_score
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("CREATE TABLE IF NOT EXISTS ops (id INTEGER PRIMARY KEY, data TEXT)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY, data TEXT)")
        self.audit = AuditLog(self.conn)
        self.reset(1)

    # ------------------------------------------------------------------ setup
    def reset(self, scenario: int = 1) -> None:
        if scenario not in SCENARIOS:
            raise Blocked("NOT_FOUND", "Нет такого сценария.", 404)
        with self.lock:
            self.now = 0.0
            self.scenario = scenario
            self.audit.clear()
            self.conn.execute("DELETE FROM ops")
            self.conn.execute("DELETE FROM incidents")
            self.conn.commit()
            self.sim = SimState()
            self.recipients = copy.deepcopy(BASE_RECIPIENTS)
            self.ward = {
                "name": "Нурлан-ата", "balance": 1_284_500, "protection_on": True, "credit_lock": False,
                "outgoing_blocked": False, "cards_blocked": False, "sessions_reset": 0,
                "whitelist": ["utility", "grandson"],
                "guardians": {"guardian": "alibek", "second": "aigul"},
                "consent": {"given": True, "given_at": 0.0, "valid_months": 12, "revocable": True,
                            "fields": ["сумма", "получатель", "причины риска"]},
            }
            self.history = [
                {"title": "Пенсия", "amount": 182_000, "minute": -60 * 24, "kind": "in"},
                {"title": "Магнум", "amount": -14_700, "minute": -60 * 30, "kind": "out"},
                {"title": "Алматы Су (коммуналка)", "amount": -3_500, "minute": -60 * 24 * 6, "kind": "out"},
            ]
            self.ops: list[Operation] = []
            self.incidents: list[Incident] = []
            self.disable_requests: list[dict] = []
            self.notifications: list[dict] = []
            self.counters = {"call_blocks": 0, "remote_blocks": 0, "credit_lock_blocks": 0,
                             "outgoing_blocks": 0, "attempts": 0}
            self.busy = {"guardian": False, "second": False}
            self._next_id = 1
            self._next_req = 1
            self.audit.append(self.now, "system", "scenario_reset", {"scenario": scenario})
            self._seed(scenario)
            self._save()

    def _seed(self, n: int) -> None:
        if n == 2:
            self.sim.set_call("active_unknown", self.now)
        if n in (3, 4):
            self.busy = {"guardian": True, "second": True}
        if n == 5:
            self.ward["credit_lock"] = True
            self.sim.set_call("ended_unknown", self.now)
        if n == 6:
            self.ward["protection_on"] = False
            self.ward["consent"]["given"] = False
            self._seed_executed("receiver_bcc", 480_000, minutes_ago=20, score_known=False)
        if n == 7:
            self._seed_executed("seller", 85_000, minutes_ago=60 * 24 * 2, score_known=True)

    def _seed_executed(self, rid: str, amount: int, minutes_ago: float, score_known: bool) -> Operation:
        rec = self.recipients[rid]
        op = Operation(id=self._take_id(), kind="transfer", amount=amount, recipient_id=rid,
                       recipient_name=rec["name"], created_at=self.now - minutes_ago, status="EXECUTED")
        op.device = {"call": "none", "night": False, "new_device": False, "remote_access": False}
        if score_known:
            res = self.scorer(Signals(amount=amount, new_recipient=True), self.cfg)
            op.score, op.zone, op.reasons = res.score, res.zone, res.reasons_dicts()
        else:
            op.score, op.zone = None, None
            op.event(op.created_at, "Операция проведена без оценки: семейная защита не была подключена.")
        op.decided_by, op.decided_at = "auto", op.created_at
        self.ops.append(op)
        self.ward["balance"] -= amount
        self.history.append({"title": rec["name"], "amount": -amount, "minute": op.created_at,
                             "kind": "out", "op_id": op.id})
        rec["known"] = True
        return op

    def _take_id(self) -> int:
        i = self._next_id
        self._next_id += 1
        return i

    # ------------------------------------------------------------------ time
    def advance(self, minutes: float) -> None:
        with self.lock:
            self.now += minutes
            self.tick()

    def advance_to(self, minute: float, step: float = 0.5) -> None:
        while self.now + step <= minute:
            self.advance(step)
        if self.now < minute:
            self.advance(minute - self.now)

    def tick(self) -> None:
        with self.lock:
            changed = False
            for op in self.ops:
                if not op.held:
                    continue
                for actor in self.ladder.tick(op, self.now):
                    changed = True
                    self.audit.append(self.now, "system", "request_sent", {"op": op.id, "to": actor})
                if self.ladder.expire(op, self.now):
                    changed = True
                    self.audit.append(self.now, "system", "hold_expired", {"op": op.id})
            for inc in self.incidents:
                before = inc.status
                self.desk.tick(inc, self.now)
                if inc.status != before:
                    changed = True
                    self.audit.append(self.now, "system", f"incident_{inc.status.lower()}", {"incident": inc.id})
            for req in self.disable_requests:
                if req["status"] == "pending" and self.now >= req["effective_at"]:
                    req["status"] = "applied"
                    key = "protection_on" if req["target"] == "protection" else "credit_lock"
                    self.ward[key] = False
                    changed = True
                    self._notify_trusted(f"Вступило в силу: {self._target_text(req['target'])} отключена.")
                    self.audit.append(self.now, "system", "disable_applied", {"target": req["target"]})
            if changed:
                self._save()

    # ------------------------------------------------------------------ simulation
    def set_sim(self, call: str | None = None, night: bool | None = None,
                new_device: bool | None = None, remote_access: bool | None = None) -> None:
        with self.lock:
            if call is not None:
                self.sim.set_call(call, self.now)
            if night is not None:
                self.sim.night = night
            if new_device is not None:
                self.sim.new_device = new_device
            if remote_access is not None:
                self.sim.remote_access = remote_access
            self.audit.append(self.now, "demo", "simulation_changed", {
                "call": self.sim.display_call(self.now, self._window()), "night": self.sim.night,
                "new_device": self.sim.new_device, "remote_access": self.sim.remote_access})

    def set_busy(self, guardian: bool | None = None, second: bool | None = None) -> None:
        if guardian is not None:
            self.busy["guardian"] = guardian
        if second is not None:
            self.busy["second"] = second

    def _window(self) -> float:
        return self.cfg["protection"]["recent_call_window_minutes"]

    # ------------------------------------------------------------------ operations
    def create_transfer(self, recipient_id: str, amount: int, big_purchase: bool = False) -> Operation:
        with self.lock:
            rec = self.recipients.get(recipient_id)
            if rec is None:
                raise Blocked("NOT_FOUND", "Получатель не найден.", 404)
            self._check_amount(amount)
            self.counters["attempts"] += 1
            if self.ward["outgoing_blocked"]:
                self.counters["outgoing_blocks"] += 1
                self.audit.append(self.now, "ward", "blocked_outgoing_blocked", {"amount": amount})
                raise Blocked("OUTGOING_BLOCKED", guards.MESSAGES["OUTGOING_BLOCKED"])
            self._guard("transfer", amount)
            op = Operation(id=self._take_id(), kind="transfer", amount=amount, recipient_id=recipient_id,
                           recipient_name=rec["name"], created_at=self.now, big_purchase=big_purchase)
            sig = Signals(amount=amount, new_recipient=not rec.get("known"),
                          flagged_recipient=bool(rec.get("flagged")),
                          whitelisted=recipient_id in self.ward["whitelist"],
                          call=guards.effective_call(self.sim, self.now, self.cfg),
                          night=self.sim.night, new_device=self.sim.new_device, big_purchase=big_purchase)
            self._evaluate(op, sig)
            return op

    def create_credit(self, amount: int, product: str = "Рассрочка на бытовую технику") -> Operation:
        with self.lock:
            self._check_amount(amount, credit=True)
            self.counters["attempts"] += 1
            self._guard("credit", amount)
            op = Operation(id=self._take_id(), kind="credit", amount=amount, recipient_id="credit",
                           recipient_name=product, created_at=self.now)
            sig = Signals(amount=amount, call=guards.effective_call(self.sim, self.now, self.cfg),
                          night=self.sim.night, new_device=self.sim.new_device)
            self._evaluate(op, sig)
            return op

    def _check_amount(self, amount: int, credit: bool = False) -> None:
        if not isinstance(amount, int) or amount <= 0:
            raise Blocked("BAD_AMOUNT", "Сумма должна быть положительным целым числом.", 400)
        if not credit and amount > self.ward["balance"]:
            raise Blocked("INSUFFICIENT_FUNDS", "На счёте недостаточно средств.", 400)

    def _guard(self, kind: str, amount: int) -> None:
        try:
            guards.check_operation(kind, self.sim, self.ward["protection_on"], self.ward["credit_lock"])
        except Blocked as b:
            key = {"CALL_ACTIVE": "call_blocks", "REMOTE_ACCESS": "remote_blocks",
                   "CREDIT_LOCK": "credit_lock_blocks"}.get(b.code)
            if key:
                self.counters[key] += 1
            self.audit.append(self.now, "ward", f"blocked_{b.code.lower()}", {"kind": kind, "amount": amount})
            raise

    def _evaluate(self, op: Operation, sig: Signals) -> None:
        op.device = {"call": sig.call, "night": sig.night, "new_device": sig.new_device,
                     "remote_access": self.sim.remote_access}
        try:
            res = self.scorer(sig, self.cfg)
            op.score, op.zone, op.reasons = res.score, res.zone, res.reasons_dicts()
        except Exception as exc:  # R0.5: сбой скоринга = жёлтая зона, не зелёная и не вечный блок
            op.score, op.zone, op.scoring_failed = None, "yellow", True
            op.reasons = [{"code": "scoring_failed", "points": 0,
                           "text": "Оценка риска временно недоступна: операция на паузе для подтверждения"}]
            self.audit.append(self.now, "system", "scoring_failed", {"op": op.id, "error": type(exc).__name__})
        self.ops.append(op)

        if not self.ward["protection_on"]:
            op.event(self.now, "Семейная защита выключена: операция проведена без подтверждения.")
            self._execute(op, "auto")
        elif op.zone == "green":
            op.event(self.now, f"Риск {op.score}: зелёная зона, операция проведена сразу.")
            self._execute(op, "auto")
        else:
            op.status = "HELD"
            op.hold_deadline = self.d.max_hold_until(self.now)
            self.audit.append(self.now, "system", "held", {"op": op.id, "score": op.score, "zone": op.zone})
            self.ladder.start(op, self.now)
            self.audit.append(self.now, "system", "request_sent", {"op": op.id, "to": "guardian"})
        self._save()

    def _execute(self, op: Operation, actor: str) -> None:
        op.status = "EXECUTED"
        if op.decided_by is None:
            op.decided_by, op.decided_at = actor, self.now
        if op.kind == "transfer":
            self.ward["balance"] -= op.amount
            self.recipients[op.recipient_id]["known"] = True
            self.history.append({"title": op.recipient_name, "amount": -op.amount, "minute": self.now,
                                 "kind": "out", "op_id": op.id})
        else:
            self.ward["balance"] += op.amount
            self.history.append({"title": f"{op.recipient_name} оформлена", "amount": op.amount,
                                 "minute": self.now, "kind": "in", "op_id": op.id})
        self.audit.append(self.now, actor, "executed", {"op": op.id, "amount": op.amount})

    def decide(self, op_id: int, actor: str, decision: str, called: bool | None = None) -> dict:
        with self.lock:
            op = self._op(op_id)
            result = self.ladder.decide(op, actor, decision, self.now, called)
            self.audit.append(self.now, actor, f"decision_{decision}", {"op": op.id, "result": result})
            if op.status == "EXECUTED":
                self._execute(op, actor)
            self._save()
            return {"result": result, "status": op.status, "zone": op.zone}

    def _op(self, op_id: int) -> Operation:
        for op in self.ops:
            if op.id == op_id:
                return op
        raise Blocked("NOT_FOUND", "Операция не найдена.", 404)

    # ------------------------------------------------------------------ protection settings
    def setup(self, first: str, whitelist: list[str], consent: bool) -> None:
        with self.lock:
            if not consent:
                raise Blocked("CONSENT_REQUIRED", "Без согласия подопечного опекуны не подключаются.", 400)
            if first not in GUARDIAN_PEOPLE:
                raise Blocked("BAD_GUARDIAN", "Неизвестный доверенный.", 400)
            unknown = [w for w in whitelist if w not in self.recipients]
            if unknown:
                raise Blocked("BAD_WHITELIST", "Неизвестный получатель в белом списке.", 400)
            second = "aigul" if first == "alibek" else "alibek"
            self.ward["guardians"] = {"guardian": first, "second": second}
            self.ward["whitelist"] = list(whitelist)
            self.ward["consent"] = {"given": True, "given_at": self.now, "valid_months": 12, "revocable": True,
                                    "fields": ["сумма", "получатель", "причины риска"]}
            self.ward["protection_on"] = True
            self.audit.append(self.now, "ward", "protection_setup",
                              {"first": first, "whitelist": whitelist, "consent": True})
            self._save()

    def set_protection(self, on: bool) -> dict:
        with self.lock:
            if on:
                if not self.ward["consent"]["given"]:
                    raise Blocked("CONSENT_REQUIRED", "Сначала пройдите настройку и дайте согласие.", 400)
                self.ward["protection_on"] = True
                self._cancel_pending("protection", "Защита снова включена.")
                self.audit.append(self.now, "ward", "protection_on", {})
                return {"protection_on": True}
            return self.request_disable("protection")

    def set_credit_lock(self, on: bool) -> dict:
        with self.lock:
            if on:
                self.ward["credit_lock"] = True
                self._cancel_pending("credit_lock", "Кредитный замок снова включён.")
                self.audit.append(self.now, "ward", "credit_lock_on", {})
                return {"credit_lock": True}
            return self.request_disable("credit_lock")

    def request_disable(self, target: str) -> dict:
        with self.lock:
            key = "protection_on" if target == "protection" else "credit_lock"
            if not self.ward[key]:
                return {"status": "already_off"}
            try:
                guards.check_disable(self.sim)
            except Blocked as b:
                self.audit.append(self.now, "ward", f"disable_refused_{b.code.lower()}", {"target": target})
                raise
            for req in self.disable_requests:
                if req["target"] == target and req["status"] == "pending":
                    return req
            req = {"id": self._next_req, "target": target, "requested_at": self.now,
                   "effective_at": self.now + self.d.disable_cooldown(), "status": "pending"}
            self._next_req += 1
            self.disable_requests.append(req)
            self._notify_trusted(f"{self.ward['name']} запросил отключение: {self._target_text(target)}. "
                                 f"Вступит в силу через период охлаждения, если запрос не отменят.")
            self.audit.append(self.now, "ward", "disable_requested", {"target": target, "effective_at": req["effective_at"]})
            self._save()
            return req

    def cancel_disable(self, req_id: int) -> dict:
        with self.lock:
            for req in self.disable_requests:
                if req["id"] == req_id and req["status"] == "pending":
                    req["status"] = "cancelled"
                    self._notify_trusted(f"Запрос на отключение отменён: {self._target_text(req['target'])}.")
                    self.audit.append(self.now, "ward", "disable_cancelled", {"target": req["target"]})
                    return req
            raise Blocked("NOT_FOUND", "Активный запрос не найден.", 404)

    def _cancel_pending(self, target: str, text: str) -> None:
        for req in self.disable_requests:
            if req["target"] == target and req["status"] == "pending":
                req["status"] = "cancelled"
                self._notify_trusted(text)

    @staticmethod
    def _target_text(target: str) -> str:
        return "семейная защита" if target == "protection" else "кредитный замок"

    def _notify_trusted(self, text: str) -> None:
        self.notifications.append({"minute": round(self.now, 2), "text": text})

    # ------------------------------------------------------------------ incidents
    def report_fraud(self, op_id: int, what: str, got_goods: bool) -> dict:
        with self.lock:
            op = self._op(op_id)
            if op.kind != "transfer" or op.status != "EXECUTED":
                raise Blocked("BAD_STATE", "Заявление подаётся по проведённому переводу.", 400)
            if any(i.op_id == op_id and i.status != "CLOSED" for i in self.incidents):
                raise Blocked("DUPLICATE", "По этому переводу заявление уже подано.", 409)
            hang_up = self.sim.call != "none"
            # Автозащита: безопасна и обратима.
            self.ward.update({"outgoing_blocked": True, "cards_blocked": True, "credit_lock": True})
            self.ward["sessions_reset"] += 1
            rec = self.recipients[op.recipient_id]
            inc = Incident(id=len(self.incidents) + 1, op_id=op.id, amount=op.amount,
                           recipient_id=op.recipient_id, recipient_name=op.recipient_name,
                           recipient_bank=rec["bank"], transfer_minute=op.created_at,
                           created_at=self.now, what=what, got_goods=got_goods)
            self.desk.open(inc, rec, {"device": op.device, "score": op.score, "zone": op.zone,
                                      "reasons": op.reasons}, self.now)
            inc.log(self.now, "Автозащита: исходящие переводы и карты заблокированы, сессии на других "
                              "устройствах сброшены, кредитный замок включён.")
            self.incidents.append(inc)
            self._notify_trusted(f"{self.ward['name']} подал заявление о спорной операции на {fmt_kzt(op.amount)}.")
            self.audit.append(self.now, "ward", "incident_opened",
                              {"incident": inc.id, "op": op.id, "status": inc.status})
            self._save()
            return {"incident": inc.id, "status": inc.status, "hang_up": hang_up}

    def incident_action(self, inc_id: int, action: str, police_report_no: str | None = None) -> dict:
        with self.lock:
            inc = next((i for i in self.incidents if i.id == inc_id), None)
            if inc is None:
                raise Blocked("NOT_FOUND", "Заявление не найдено.", 404)
            before = inc.status
            self.desk.act(inc, action, self.now, police_report_no)
            if inc.status == "RETURNED" and before != "RETURNED":
                self.ward["balance"] += inc.amount
                self.history.append({"title": f"Возврат по заявлению № {inc.id}", "amount": inc.amount,
                                     "minute": self.now, "kind": "in"})
            if action == "close" and inc.outcome != "civil":
                self.recipients[inc.recipient_id]["flagged"] = True
                inc.log(self.now, "Получатель внесён в базу подозрительных счетов банка.")
            self.audit.append(self.now, "operator", f"incident_{action}",
                              {"incident": inc.id, "from": before, "to": inc.status})
            self._save()
            return {"status": inc.status}

    def unblock_client(self) -> None:
        with self.lock:
            self.ward.update({"outgoing_blocked": False, "cards_blocked": False})
            self.audit.append(self.now, "operator", "client_unblocked", {})

    # ------------------------------------------------------------------ stats
    def stats(self) -> dict:
        transfers = [o for o in self.ops if o.kind == "transfer"]
        held_ever = [o for o in self.ops if o.hold_deadline is not None]
        held_done = [o for o in held_ever if not o.held]
        false_delays = [o for o in held_done if o.status == "EXECUTED"]
        freezes = [i.frozen_at - i.transfer_minute for i in self.incidents if i.frozen_at is not None]
        return {
            "synthetic": True,
            "attempts": self.counters["attempts"],
            "transfers": len(transfers),
            "executed": len([o for o in self.ops if o.status == "EXECUTED"]),
            "held_now": len([o for o in self.ops if o.held]),
            "stopped": len([o for o in self.ops if o.status == "REJECTED"]),
            "expired": len([o for o in self.ops if o.status == "EXPIRED"]),
            "saved_amount": sum(o.amount for o in self.ops if o.status == "REJECTED" and o.kind == "transfer"),
            "call_blocks": self.counters["call_blocks"],
            "remote_blocks": self.counters["remote_blocks"],
            "credit_lock_blocks": self.counters["credit_lock_blocks"],
            "false_delay_share": round(len(false_delays) / len(held_done), 2) if held_done else None,
            "time_to_freeze_minutes": round(sum(freezes) / len(freezes), 1) if freezes else None,
            "incidents": len(self.incidents),
        }

    # ------------------------------------------------------------------ views
    def guardian_name(self, role: str) -> str:
        p = GUARDIAN_PEOPLE[self.ward["guardians"][role]]
        return f"{p['name']}, {p['relation']}"

    def view_ward(self) -> dict:
        w = self.ward
        pending = []
        for op in self.ops:
            if op.held:
                pending.append({
                    "id": op.id, "kind": op.kind, "amount": op.amount, "recipient": op.recipient_name,
                    "zone": op.zone, "new_recipient": any(r["code"] == "new_recipient" for r in op.reasons),
                    "call_reason": any(r["code"] == "call_unknown" for r in op.reasons),
                    "can_self_confirm": "ward" in op.notified,
                    "operator_connected": "operator" in op.notified,
                    "guardian_acc": GUARDIAN_PEOPLE[self.ward["guardians"]["guardian"]]["acc"],
                    "minutes": round(self.now - op.created_at, 1),
                })
        last = self.ops[-1] if self.ops else None
        return {
            "name": w["name"], "balance": w["balance"], "protection_on": w["protection_on"],
            "credit_lock": w["credit_lock"], "outgoing_blocked": w["outgoing_blocked"],
            "cards_blocked": w["cards_blocked"], "consent": w["consent"],
            "guardians": {"guardian": self.guardian_name("guardian"), "second": self.guardian_name("second")},
            "guardian_keys": w["guardians"],
            "whitelist": w["whitelist"],
            "recipients": [{"id": k, "name": v["name"], "whitelisted": k in w["whitelist"], "known": v["known"]}
                           for k, v in self.recipients.items() if k not in ("receiver_bcc", "seller")],
            "history": sorted(self.history, key=lambda h: -h["minute"])[:12],
            "reportable": [{"id": o.id, "recipient": o.recipient_name, "amount": o.amount,
                            "minutes_ago": round(self.now - o.created_at)}
                           for o in reversed(self.ops) if o.kind == "transfer" and o.status == "EXECUTED"][:5],
            "pending": pending,
            "last": self._op_brief(last) if last else None,
            "disable_requests": [dict(r, left=round(max(0, r["effective_at"] - self.now), 1))
                                 for r in self.disable_requests if r["status"] == "pending"],
            "incidents": [{"id": i.id, "status": i.status, "status_text": STATUS_TEXT[i.status],
                           "amount": i.amount, "recipient": i.recipient_name, "feed": i.feed,
                           "outcome": OUTCOME_TEXT.get(i.outcome) if i.outcome else None,
                           "statement": police_statement(i, w["name"]) if i.status != "DISPUTE_CIVIL" else None}
                          for i in self.incidents],
        }

    def _op_brief(self, op: Operation) -> dict:
        return {"id": op.id, "kind": op.kind, "amount": op.amount, "recipient": op.recipient_name,
                "status": op.status, "zone": op.zone, "score": op.score,
                "decided_by": ACTOR_LABELS.get(op.decided_by, op.decided_by)}

    def view_trusted(self, role: str) -> dict:
        """Опекун и второй доверенный: только операции на подтверждении. Без баланса, истории и кодов."""
        reqs = []
        for op in self.ops:
            if role not in op.notified:
                continue
            other = "second" if role == "guardian" else "guardian"
            reqs.append({
                "id": op.id, "kind": op.kind, "amount": op.amount, "recipient": op.recipient_name,
                "zone": op.zone, "score": op.score, "reasons": [r["text"] for r in op.reasons if r["points"] >= 0],
                "status": op.status,
                "can_act": op.held and role not in op.approvals,
                "approved_by_me": role in op.approvals,
                "other_approved": other in op.approvals,
                "needs_second": op.zone == "red",
                "minutes": round(self.now - op.created_at, 1),
            })
        return {"role": role, "name": self.guardian_name(role), "busy": self.busy.get(role, False),
                "ward_name": self.ward["name"], "requests": reqs[-5:],
                "notifications": self.notifications[-6:]}

    def view_operator(self) -> dict:
        queue = []
        for op in self.ops:
            if op.hold_deadline is None:
                continue
            queue.append({
                "id": op.id, "kind": op.kind, "amount": op.amount, "recipient": op.recipient_name,
                "zone": op.zone, "score": op.score, "reasons": op.reasons, "device": op.device,
                "status": op.status, "my_turn": op.held and "operator" in op.notified,
                "approvals": {ACTOR_LABELS[a]: m for a, m in op.approvals.items()},
                "operator_due": round(self.ladder.operator_due(op) - self.now, 1) if op.held else None,
                "deadline_left": round(op.hold_deadline - self.now, 1) if op.held else None,
                "events": op.events[-8:], "scoring_failed": op.scoring_failed,
            })
        incs = []
        for i in self.incidents:
            incs.append({
                "id": i.id, "status": i.status, "status_text": STATUS_TEXT[i.status], "priority": i.priority,
                "card": i.card, "feed": i.feed, "police_report_no": i.police_report_no,
                "recipient_explained": i.recipient_explained,
                "hold_left": round(i.hold_until - self.now, 1) if i.status == "HELD" else None,
                "can_extend": i.status == "HELD" and i.hold_until < i.hold_max_until,
                "outcome": OUTCOME_TEXT.get(i.outcome) if i.outcome else None,
            })
        return {"queue": list(reversed(queue))[:8], "incidents": list(reversed(incs)),
                "client": {"outgoing_blocked": self.ward["outgoing_blocked"],
                           "cards_blocked": self.ward["cards_blocked"]}}

    def view_bank(self) -> dict:
        recent = [{"id": o.id, "kind": o.kind, "amount": o.amount, "recipient": o.recipient_name,
                   "score": o.score, "zone": o.zone, "status": o.status, "reasons": o.reasons}
                  for o in reversed(self.ops)][:6]
        return {"stats": self.stats(), "recent": recent, "audit": self.audit.tail(25),
                "audit_verify": self.audit.verify()}

    def view_demo(self) -> dict:
        s = SCENARIOS[self.scenario]
        return {"now": round(self.now, 2), "scenario": self.scenario, "title": s["title"], "hint": s["hint"],
                "form": s["form"], "busy": self.busy,
                "sim": {"call": self.sim.display_call(self.now, self._window()), "night": self.sim.night,
                        "new_device": self.sim.new_device, "remote_access": self.sim.remote_access},
                "scenarios": {k: v["title"] for k, v in SCENARIOS.items()}}

    def full_state(self) -> dict:
        with self.lock:
            return {"ward": self.view_ward(), "guardian": self.view_trusted("guardian"),
                    "second": self.view_trusted("second"), "operator": self.view_operator(),
                    "bank": self.view_bank(), "demo": self.view_demo()}

    # ------------------------------------------------------------------ persistence
    def _save(self) -> None:
        with self.lock:
            self.conn.executemany("INSERT OR REPLACE INTO ops (id, data) VALUES (?, ?)",
                                  [(o.id, json.dumps(asdict(o), ensure_ascii=False)) for o in self.ops])
            self.conn.executemany("INSERT OR REPLACE INTO incidents (id, data) VALUES (?, ?)",
                                  [(i.id, json.dumps(asdict(i), ensure_ascii=False)) for i in self.incidents])
            self.conn.commit()
