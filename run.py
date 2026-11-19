"""Запуск «Қорған» одной командой: python run.py  →  http://127.0.0.1:8000"""
import os

import uvicorn

from backend.app import create_app

if __name__ == "__main__":
    host = os.environ.get("KORGAN_HOST", "127.0.0.1")
    port = int(os.environ.get("KORGAN_PORT", "8000"))
    print(f"Қорған: http://{host}:{port}")
    uvicorn.run(create_app(), host=host, port=port, log_level="warning")
