"""Слой 0: жёсткие предохранители. Работают до скоринга и не зависят от него."""
from __future__ import annotations

from dataclasses import dataclass


class Blocked(Exception):
    """Операция отклонена правилом. code — машинный код, message — текст для человека."""

    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message}


MESSAGES = {
    "CALL_ACTIVE": "Во время разговора по телефону переводы и кредиты недоступны. "
                   "Если вас просят перевести деньги, это мошенники. Положите трубку.",
    "REMOTE_ACCESS": "На телефоне включён удалённый доступ. Денежные операции и снятие защиты недоступны. "
                     "Отключите программу удалённого доступа: настоящий сотрудник банка никогда её не просит.",
    "CREDIT_LOCK": "Включён кредитный замок: оформление кредитов и рассрочек запрещено. "
                   "Снять замок можно в разделе «Защита», он отключится через период охлаждения.",
    "OUTGOING_BLOCKED": "Исходящие переводы временно заблокированы после заявления о спорной операции. "
                        "Разблокировать их может сотрудник банка.",
    "NEW_DEVICE": "Снять защиту с нового устройства нельзя в первые сутки.",
}


@dataclass
class SimState:
    """Эмулируемые сигналы устройства. В продакшене их даёт телефон, оператор связи или Антифрод-центр."""
    call: str = "none"                 # идёт звонок: none | known | unknown
    last_call_type: str | None = None  # тип последнего завершённого звонка
    last_call_end: float | None = None # минута сценария, когда звонок завершился
    night: bool = False
    new_device: bool = False
    remote_access: bool = False

    def set_call(self, state: str, now: float) -> None:
        """Пять состояний переключателя: none, active_known, active_unknown, ended_known, ended_unknown."""
        if state in ("active_known", "active_unknown"):
            self.call = state.split("_", 1)[1]
            return
        if state in ("ended_known", "ended_unknown"):
            self.call = "none"
            self.last_call_type = state.split("_", 1)[1]
            self.last_call_end = now
            return
        if state != "none":
            raise ValueError(f"unknown call state {state}")
        if self.call != "none":
            # Система сама замечает переход «идёт» → «нет» и запоминает завершение.
            self.last_call_type = self.call
            self.last_call_end = now
            self.call = "none"
        else:
            self.last_call_type = None
            self.last_call_end = None

    def display_call(self, now: float, window: float) -> str:
        if self.call != "none":
            return f"active_{self.call}"
        if self.last_call_end is not None and now - self.last_call_end < window:
            return f"ended_{self.last_call_type}"
        return "none"


def effective_call(sim: SimState, now: float, cfg: dict) -> str:
    """Звонок для скоринга: идущий или завершившийся в окне R0.2."""
    if sim.call != "none":
        return sim.call
    window = cfg["protection"]["recent_call_window_minutes"]
    if sim.last_call_end is not None and now - sim.last_call_end < window:
        return sim.last_call_type or "none"
    return "none"


def check_operation(kind: str, sim: SimState, protection_on: bool, credit_lock: bool) -> None:
    """kind: transfer | credit. Бросает Blocked. Порядок: R0.3, R0.1, R0.4."""
    if protection_on and sim.remote_access:
        raise Blocked("REMOTE_ACCESS", MESSAGES["REMOTE_ACCESS"])
    if protection_on and sim.call != "none":
        raise Blocked("CALL_ACTIVE", MESSAGES["CALL_ACTIVE"])
    if kind == "credit" and credit_lock:
        raise Blocked("CREDIT_LOCK", MESSAGES["CREDIT_LOCK"])


def check_disable(sim: SimState) -> None:
    """R0.6: снять защиту или замок нельзя во время звонка, при удалённом доступе, с нового устройства."""
    if sim.remote_access:
        raise Blocked("REMOTE_ACCESS", MESSAGES["REMOTE_ACCESS"])
    if sim.call != "none":
        raise Blocked("CALL_ACTIVE", "Во время звонка снять защиту нельзя. Если вас просят отключить защиту, это мошенники.")
    if sim.new_device:
        raise Blocked("NEW_DEVICE", MESSAGES["NEW_DEVICE"])
