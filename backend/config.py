"""Загрузка config.yaml и производные сроки в минутах сценария."""
from __future__ import annotations

import copy
from datetime import datetime, timedelta
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "config.yaml"


def load_config(path: str | Path | None = None, **overrides) -> dict:
    with open(path or DEFAULT_CONFIG, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    cfg = copy.deepcopy(cfg)
    for key, value in overrides.items():
        cfg[key] = value
    return cfg


class Durations:
    """Переводит сроки из конфига в минуты сценария с учётом демо-режима."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.demo = bool(cfg.get("demo_mode"))
        self.demo_over = cfg.get("demo_overrides", {})
        self.start = datetime.fromisoformat(cfg["clock"]["start"])

    def disable_cooldown(self) -> float:
        if self.demo:
            return float(self.demo_over["disable_cooldown_minutes"])
        return cfg_hours(self.cfg["protection"]["disable_cooldown_hours"])

    def initial_hold(self) -> float:
        if self.demo:
            return float(self.demo_over["initial_hold_minutes"])
        return cfg_hours(self.cfg["incidents"]["initial_hold_hours"])

    def max_hold_until(self, from_minute: float) -> float:
        """R0.7: момент, позже которого удержание длиться не может."""
        if self.demo:
            return from_minute + float(self.demo_over["max_hold_minutes"])
        days = int(self.cfg["protection"]["max_hold_working_days"])
        start_dt = self.start + timedelta(minutes=from_minute)
        end_dt = add_working_days(start_dt, days)
        return (end_dt - self.start).total_seconds() / 60.0


def cfg_hours(hours: float) -> float:
    return float(hours) * 60.0


def add_working_days(start: datetime, days: int) -> datetime:
    """Прибавляет рабочие дни (пн–пт). Праздники РК в прототипе не учитываются."""
    current = start
    added = 0
    while added < days:
        current += timedelta(days=1)
        if current.weekday() < 5:
            added += 1
    return current
