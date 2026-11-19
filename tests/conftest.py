import pytest

from backend.config import load_config
from backend.engine import Engine


@pytest.fixture
def cfg():
    return load_config()


@pytest.fixture
def engine(cfg):
    return Engine(cfg)


@pytest.fixture
def real_cfg():
    """Конфиг без демо-сжатия сроков (24 ч, 48 ч, 5 рабочих дней)."""
    return load_config(demo_mode=False)
