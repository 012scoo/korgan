"""E2E: семь сценариев через HTTP API с ролевыми токенами. Часы двигаются вручную."""
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app

H = {r: {"X-Korgan-Token": f"demo-{r}"} for r in ("ward", "guardian", "second", "operator", "bank", "demo")}


@pytest.fixture
def api():
    app = create_app(db_path=":memory:", run_clock=False)
    with TestClient(app) as client:
        client.engine = app.state.engine
        yield client


def scenario(api, n):
    r = api.post(f"/api/scenario/{n}", headers=H["demo"])
    assert r.status_code == 200
    return r.json()


def go(api, minute):
    api.engine.advance_to(minute)


def test_roles_are_enforced(api):
    assert api.get("/api/state").status_code == 401
    r = api.post("/api/ward/transfer", json={"recipient_id": "utility", "amount": 3500}, headers=H["guardian"])
    assert r.status_code == 403
    r = api.post("/api/scenario/1", headers=H["ward"])
    assert r.status_code == 403
    guardian_state = api.get("/api/state", headers=H["guardian"]).json()
    assert "ward" not in guardian_state and "balance" not in repr(guardian_state)


def test_scenario_1_utility(api):
    scenario(api, 1)
    r = api.post("/api/ward/transfer", json={"recipient_id": "utility", "amount": 3500}, headers=H["ward"])
    body = r.json()
    assert r.status_code == 200 and body["score"] == 0 and body["status"] == "EXECUTED"


def test_scenario_2_coached_fraud(api):
    scenario(api, 2)
    tx = {"recipient_id": "stranger", "amount": 480000}
    r = api.post("/api/ward/transfer", json=tx, headers=H["ward"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "CALL_ACTIVE"
    api.post("/api/sim", json={"call": "none"}, headers=H["demo"])      # положил трубку
    go(api, 1)
    r = api.post("/api/ward/transfer", json=tx, headers=H["ward"])
    op = r.json()
    assert op["score"] == 100 and op["zone"] == "red" and op["status"] == "HELD"
    r = api.post(f"/api/ops/{op['id']}/decision", json={"decision": "reject"}, headers=H["guardian"])
    assert r.json()["status"] == "REJECTED"
    stats = api.get("/api/bank/stats", headers=H["bank"]).json()
    assert stats["call_blocks"] == 1 and stats["saved_amount"] == 480000


def test_scenario_3_real_purchase_operator(api):
    scenario(api, 3)
    r = api.post("/api/ward/transfer", json={"recipient_id": "shop", "amount": 480000, "big_purchase": True},
                 headers=H["ward"])
    op = r.json()
    assert op["score"] == 30 and op["zone"] == "yellow"
    go(api, 12)
    ward = api.get("/api/state", headers=H["ward"]).json()["ward"]
    assert ward["pending"][0]["can_self_confirm"] is False
    r = api.post(f"/api/ops/{op['id']}/decision", json={"decision": "approve"}, headers=H["operator"])
    assert r.status_code == 403                                        # ещё не очередь оператора
    go(api, 15)
    r = api.post(f"/api/ops/{op['id']}/decision", json={"decision": "approve"}, headers=H["operator"])
    assert r.json()["status"] == "EXECUTED"
    assert api.get("/api/bank/stats", headers=H["bank"]).json()["false_delay_share"] == 1.0


def test_scenario_4_no_self_confirm(api):
    scenario(api, 4)
    op = api.post("/api/ward/transfer", json={"recipient_id": "repair", "amount": 120000},
                  headers=H["ward"]).json()
    assert op["score"] == 35 and op["zone"] == "yellow"
    go(api, 10)
    r = api.post(f"/api/ward/ops/{op['id']}/self-confirm", json={"decision": "approve", "called": False},
                 headers=H["ward"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "SELF_CONFIRM_UNAVAILABLE"


def test_scenario_5_credit_lock(api):
    scenario(api, 5)
    r = api.post("/api/ward/credit", json={"amount": 300000}, headers=H["ward"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "CREDIT_LOCK"
    req = api.post("/api/ward/credit-lock", json={"on": False}, headers=H["ward"]).json()
    assert req["status"] == "pending"
    guardian = api.get("/api/state", headers=H["guardian"]).json()["guardian"]
    assert any("кредитный замок" in n["text"] for n in guardian["notifications"])
    r = api.post("/api/ward/credit", json={"amount": 300000}, headers=H["ward"])
    assert r.json()["error"]["code"] == "CREDIT_LOCK"                  # во время охлаждения замок действует
    stats = api.get("/api/bank/stats", headers=H["bank"]).json()
    assert stats["credit_lock_blocks"] == 2


def test_scenario_6_first_60_minutes(api):
    scenario(api, 6)
    ward = api.get("/api/state", headers=H["ward"]).json()["ward"]
    op_id = ward["reportable"][0]["id"]
    r = api.post("/api/ward/report", json={"op_id": op_id, "what": "bank_call", "got_goods": False},
                 headers=H["ward"])
    assert r.json()["status"] == "TRIAGED"
    op_view = api.get("/api/state", headers=H["operator"]).json()["operator"]
    inc = op_view["incidents"][0]
    assert inc["priority"] == "high" and inc["card"]["recipient"]["money_location"] == "in_bcc"
    r = api.post(f"/api/operator/incidents/{inc['id']}/freeze", json={}, headers=H["operator"])
    assert r.json()["status"] == "HELD"
    ward = api.get("/api/state", headers=H["ward"]).json()["ward"]
    feed = [f["status"] for f in ward["incidents"][0]["feed"]]
    assert "HELD" in feed and ward["incidents"][0]["statement"]
    assert ward["outgoing_blocked"] and ward["credit_lock"]
    assert api.get("/api/bank/stats", headers=H["bank"]).json()["time_to_freeze_minutes"] == 20.0


def test_scenario_7_civil_dispute(api):
    scenario(api, 7)
    ward = api.get("/api/state", headers=H["ward"]).json()["ward"]
    op_id = ward["reportable"][0]["id"]
    r = api.post("/api/ward/report", json={"op_id": op_id, "what": "purchase", "got_goods": True},
                 headers=H["ward"])
    assert r.json()["status"] == "DISPUTE_CIVIL"
    inc = api.get("/api/state", headers=H["operator"]).json()["operator"]["incidents"][0]
    r = api.post(f"/api/operator/incidents/{inc['id']}/freeze", json={}, headers=H["operator"])
    assert r.status_code == 409


def test_audit_endpoint_verifies_chain(api):
    scenario(api, 2)
    api.post("/api/sim", json={"call": "none"}, headers=H["demo"])
    api.post("/api/ward/transfer", json={"recipient_id": "stranger", "amount": 480000}, headers=H["ward"])
    body = api.get("/api/audit", headers=H["bank"]).json()
    assert body["verify"]["ok"] and body["verify"]["records"] >= 4
