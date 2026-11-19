"""HTTP API «Қорған» (FastAPI). Ролевой доступ по токену в заголовке X-Korgan-Token."""
from __future__ import annotations

import asyncio
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import ROOT, load_config
from .engine import Engine
from .guards import Blocked

FRONTEND = ROOT / "frontend"
ROLES = ("ward", "guardian", "second", "operator", "bank", "demo")


def load_tokens() -> dict[str, str]:
    """Токены ролей из окружения. Демо-значения по умолчанию только для локального запуска."""
    tokens = {}
    for role in ROLES:
        tokens[os.environ.get(f"KORGAN_TOKEN_{role.upper()}", f"demo-{role}")] = role
    return tokens


# ---------------------------------------------------------------- request bodies
class TransferIn(BaseModel):
    recipient_id: str
    amount: int = Field(gt=0)
    big_purchase: bool = False


class CreditIn(BaseModel):
    amount: int = Field(gt=0)
    product: str = "Рассрочка на бытовую технику"


class DecisionIn(BaseModel):
    decision: str
    called: bool | None = None


class SetupIn(BaseModel):
    first: str
    whitelist: list[str]
    consent: bool


class ToggleIn(BaseModel):
    on: bool


class ReportIn(BaseModel):
    op_id: int
    what: str
    got_goods: bool


class IncidentActionIn(BaseModel):
    police_report_no: str | None = None


class SimIn(BaseModel):
    call: str | None = None
    night: bool | None = None
    new_device: bool | None = None
    remote_access: bool | None = None


class BusyIn(BaseModel):
    guardian: bool | None = None
    second: bool | None = None


def create_app(config_path: str | Path | None = None, db_path: str | None = None,
               run_clock: bool = True, engine: Engine | None = None) -> FastAPI:
    cfg = load_config(config_path)
    db = db_path or os.environ.get("KORGAN_DB", str(ROOT / "data" / "korgan.db"))
    if db != ":memory:":
        Path(db).parent.mkdir(parents=True, exist_ok=True)
    eng = engine or Engine(cfg, db)
    tokens = load_tokens()
    sec_per_min = float(cfg["clock"]["seconds_per_minute"])

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = None
        if run_clock:
            async def clock():
                last = time.monotonic()
                while True:
                    await asyncio.sleep(0.25)
                    now = time.monotonic()
                    eng.advance((now - last) / sec_per_min)
                    last = now
            task = asyncio.create_task(clock())
        yield
        if task:
            task.cancel()

    app = FastAPI(title="Қорған API", lifespan=lifespan)
    app.state.engine = eng

    @app.exception_handler(Blocked)
    async def blocked_handler(_: Request, exc: Blocked):
        return JSONResponse(status_code=exc.status, content={"error": exc.as_dict()})

    def role_of(x_korgan_token: str | None = Header(default=None)) -> str:
        role = tokens.get(x_korgan_token or "")
        if role is None:
            raise Blocked("UNAUTHORIZED", "Нужен действительный токен роли.", 401)
        return role

    def need(*allowed: str):
        def dep(role: str = Depends(role_of)) -> str:
            if role not in allowed and role != "demo":
                raise Blocked("FORBIDDEN", "Этой роли действие недоступно.", 403)
            return role
        return dep

    def need_strict(*allowed: str):
        """Без исключения для демо-роли: решение принимает конкретный участник."""
        def dep(role: str = Depends(role_of)) -> str:
            if role not in allowed:
                raise Blocked("FORBIDDEN", "Этой роли действие недоступно.", 403)
            return role
        return dep

    # ------------------------------------------------------------ state
    @app.get("/api/state")
    def state(role: str = Depends(role_of)):
        full = eng.full_state()
        if role == "demo":
            return full
        view = {"ward": "ward", "guardian": "guardian", "second": "second", "operator": "operator",
                "bank": "bank"}[role]
        return {view: full[view], "now": full["demo"]["now"]}

    # ------------------------------------------------------------ ward
    @app.post("/api/ward/transfer")
    def transfer(body: TransferIn, _: str = Depends(need("ward"))):
        op = eng.create_transfer(body.recipient_id, body.amount, body.big_purchase)
        return eng._op_brief(op)

    @app.post("/api/ward/credit")
    def credit(body: CreditIn, _: str = Depends(need("ward"))):
        op = eng.create_credit(body.amount, body.product)
        return eng._op_brief(op)

    @app.post("/api/ward/ops/{op_id}/self-confirm")
    def self_confirm(op_id: int, body: DecisionIn, _: str = Depends(need("ward"))):
        return eng.decide(op_id, "ward", body.decision, body.called)

    @app.post("/api/ward/setup")
    def setup(body: SetupIn, _: str = Depends(need("ward"))):
        eng.setup(body.first, body.whitelist, body.consent)
        return {"ok": True}

    @app.post("/api/ward/protection")
    def protection(body: ToggleIn, _: str = Depends(need("ward"))):
        return eng.set_protection(body.on)

    @app.post("/api/ward/credit-lock")
    def credit_lock(body: ToggleIn, _: str = Depends(need("ward"))):
        return eng.set_credit_lock(body.on)

    @app.post("/api/ward/disable-requests/{req_id}/cancel")
    def cancel_disable(req_id: int, _: str = Depends(need("ward"))):
        return eng.cancel_disable(req_id)

    @app.post("/api/ward/report")
    def report(body: ReportIn, _: str = Depends(need("ward"))):
        return eng.report_fraud(body.op_id, body.what, body.got_goods)

    # ------------------------------------------------------------ guardians and operator
    @app.post("/api/ops/{op_id}/decision")
    def decision(op_id: int, body: DecisionIn,
                 x_korgan_actor: str | None = Header(default=None),
                 role: str = Depends(role_of)):
        # Демо-страница действует от имени участника, указанного в X-Korgan-Actor.
        actor = x_korgan_actor if role == "demo" else role
        if actor not in ("guardian", "second", "operator"):
            raise Blocked("FORBIDDEN", "Решение принимают опекун, второй доверенный или оператор.", 403)
        return eng.decide(op_id, actor, body.decision)

    @app.post("/api/operator/incidents/{inc_id}/{action}")
    def incident_action(inc_id: int, action: str, body: IncidentActionIn,
                        _: str = Depends(need("operator"))):
        return eng.incident_action(inc_id, action, body.police_report_no)

    @app.post("/api/operator/client/unblock")
    def unblock(_: str = Depends(need("operator"))):
        eng.unblock_client()
        return {"ok": True}

    # ------------------------------------------------------------ bank
    @app.get("/api/bank/stats")
    def stats(_: str = Depends(need("bank", "operator"))):
        return eng.stats()

    @app.get("/api/audit")
    def audit(_: str = Depends(need("bank", "operator"))):
        return {"records": eng.audit.tail(200), "verify": eng.audit.verify()}

    # ------------------------------------------------------------ demo controls
    @app.post("/api/sim")
    def sim(body: SimIn, _: str = Depends(need_strict("demo"))):
        try:
            eng.set_sim(body.call, body.night, body.new_device, body.remote_access)
        except ValueError as exc:
            raise Blocked("BAD_SIM", str(exc), 400)
        return eng.view_demo()

    @app.post("/api/demo/busy")
    def busy(body: BusyIn, _: str = Depends(need_strict("demo"))):
        eng.set_busy(body.guardian, body.second)
        return {"busy": eng.busy}

    @app.post("/api/scenario/{n}")
    def scenario(n: int, _: str = Depends(need_strict("demo"))):
        eng.reset(n)
        return eng.view_demo()

    @app.get("/api/demo/config")
    def demo_config():
        """Токен демо-страницы. Отдаётся только при KORGAN_DEMO_PAGE != 0."""
        if os.environ.get("KORGAN_DEMO_PAGE", "1") == "0":
            raise Blocked("FORBIDDEN", "Демо-страница отключена.", 403)
        demo_token = next(t for t, r in tokens.items() if r == "demo")
        return {"token": demo_token, "seconds_per_minute": sec_per_min}

    # ------------------------------------------------------------ frontend
    if FRONTEND.exists():
        app.mount("/static", StaticFiles(directory=FRONTEND), name="static")

        @app.get("/")
        def index():
            return FileResponse(FRONTEND / "index.html")

    return app
