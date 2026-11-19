"""Проверка длины описания для формы: python docs/check_length.py"""
from pathlib import Path

text = (Path(__file__).parent / "form-description.md").read_text(encoding="utf-8").strip()
LIMIT = 1500
print(f"{len(text)} / {LIMIT} знаков", "OK" if len(text) <= LIMIT else "СЛИШКОМ ДЛИННО")
raise SystemExit(0 if len(text) <= LIMIT else 1)
