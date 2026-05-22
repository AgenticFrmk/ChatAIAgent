"""
Mock API — mirrors Cradlepoint NCM API v2 paths for the connectivity.cradlepoint domain.

Mirrors real NCM base URL: https://www.cradlepointecm.com/api/v2/
Mock base URL:             http://mock-api:8080/ncm/api/v2/

All GET endpoints accept ?router_id= as a query param (ToolDispatcher passes tool inputs
as query params for GET calls). POST/PATCH endpoints accept JSON body.

Pass ?scenario=success to get the post-repair success state for verification steps.

Endpoints (NCM API v2 paths):
  GET   /ncm/api/v2/routers/                               → get_router_list
  GET   /ncm/api/v2/routers/{router_id}/                   → get_router_status
  GET   /ncm/api/v2/net_device_signal_samples/             → get_wan_telemetry
  GET   /ncm/api/v2/router_alerts/                         → get_tunnel_status
  POST  /ncm/api/v2/reboot_activity/                       → reset_modem
  PATCH /ncm/api/v2/configuration_managers/{router_id}/    → apply_mtu_fix

  GET   /health
"""
from __future__ import annotations

from fastapi import FastAPI, Path, Query
from pydantic import BaseModel

app = FastAPI(title="CradlepointNCMMockAPI", version="2.0.0")


# ── Request bodies ────────────────────────────────────────────────────────────

class RebootActivityRequest(BaseModel):
    router: str = "/api/v2/routers/550e8400-0001/"


class MtuFixRequest(BaseModel):
    mtu: int = 1372
    mss_clamping: bool = True
    mss_clamp_value: int = 1332


# ── Scenario payloads — fault state (default) ─────────────────────────────────

_ROUTER_LIST = {
    "routers": [
        {
            "id": "550e8400-0001",
            "name": "BRANCH-BOSTON-R01",
            "product_name": "IBR1700",
            "state": "online",
            "firmware": "7.22.40",
            "last_seen": "2026-05-16T09:10:00Z",
        },
        {
            "id": "550e8400-0002",
            "name": "BRANCH-NEWYORK-R01",
            "product_name": "E3000",
            "state": "online",
            "firmware": "7.22.40",
            "last_seen": "2026-05-16T09:09:55Z",
        },
        {
            "id": "550e8400-0003",
            "name": "BRANCH-CHICAGO-R01",
            "product_name": "IBR900",
            "state": "online",
            "firmware": "7.22.40",
            "last_seen": "2026-05-16T09:09:50Z",
        },
    ],
    "meta": {"total_count": 3, "next": None, "previous": None},
}

_ROUTER_STATUS_FAULT = {
    "state": "online",
    "firmware": "7.22.40",
    "serial_number": "MMB1700-001",
    "net_devices": [
        {
            "uid": "0-1",
            "type": "mdm",
            "mode": "active",
            "connection_state": "connected",
            "carrier": "AT&T",
            "rsrp": -88,
            "rsrq": -9,
            "sinr": 14.2,
            "technology": "LTE",
        },
        {
            "uid": "0-2",
            "type": "ethernet",
            "mode": "backup",
            "connection_state": "standby",
        },
    ],
}

_WAN_TELEMETRY_FAULT = {
    "data": [
        {
            "net_device": "/api/v2/net_devices/nd-boston-01/",
            "rsrp": -88,
            "rsrq": -9,
            "sinr": 14.2,
            "rssi": -65,
            "signal_percent": 75,
            "uptime": 95820,
            "created_at": "2026-05-16T09:10:00Z",
        }
    ],
    "meta": {"total_count": 1, "next": None, "limit": 20, "offset": 0},
}

_TUNNEL_STATUS_FAULT = {
    "data": [
        {
            "id": "alert-001",
            "router": "/api/v2/routers/550e8400-0001/",
            "alert_type": "tunnel_down",
            "detected_at": "2026-05-16T09:10:12Z",
            "cleared_at": None,
            "details": {
                "tunnel_name": "vpn-hq-001",
                "last_error": "ICMP_FRAG_NEEDED",
                "mtu": 1500,
                "flap_count": 7,
            },
        }
    ],
    "meta": {"total_count": 7, "next": None},
}

# ── Scenario payloads — success state (post-repair verification) ──────────────

_ROUTER_STATUS_OK = {
    **_ROUTER_STATUS_FAULT,
    "net_devices": [
        {
            "uid": "0-1",
            "type": "mdm",
            "mode": "active",
            "connection_state": "connected",
            "carrier": "AT&T",
            "rsrp": -88,
            "rsrq": -9,
            "sinr": 14.2,
            "technology": "LTE",
        },
        {
            "uid": "0-2",
            "type": "ethernet",
            "mode": "backup",
            "connection_state": "standby",
        },
    ],
}

_WAN_TELEMETRY_OK = {
    "data": [
        {
            "net_device": "/api/v2/net_devices/nd-boston-01/",
            "rsrp": -75,
            "rsrq": -7,
            "sinr": 18.5,
            "rssi": -55,
            "signal_percent": 92,
            "uptime": 99200,
            "created_at": "2026-05-16T09:16:30Z",
        }
    ],
    "meta": {"total_count": 1, "next": None, "limit": 20, "offset": 0},
}

_TUNNEL_STATUS_OK = {
    "data": [],
    "meta": {"total_count": 0, "next": None},
}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/ncm/api/v2/routers/")
def get_router_list(
    state_filter: str = Query(default="", description="Optional state filter"),
) -> dict:
    if state_filter:
        routers = [r for r in _ROUTER_LIST["routers"] if r["state"] == state_filter]
        return {"routers": routers, "meta": {"total_count": len(routers)}}
    return _ROUTER_LIST


@app.get("/ncm/api/v2/routers/{router_id}/")
def get_router_status(
    router_id: str = Path(...),
    scenario: str = Query(default="fault", description="fault | success"),
) -> dict:
    status = _ROUTER_STATUS_OK if scenario == "success" else _ROUTER_STATUS_FAULT
    return {"router_id": router_id, "name": "BRANCH-BOSTON-R01", **status}


@app.get("/ncm/api/v2/net_device_signal_samples/")
def get_wan_telemetry(
    router_id: str = Query(default="550e8400-0001"),
    scenario: str = Query(default="fault", description="fault | success"),
) -> dict:
    return _WAN_TELEMETRY_OK if scenario == "success" else _WAN_TELEMETRY_FAULT


@app.get("/ncm/api/v2/router_alerts/")
def get_tunnel_status(
    router_id: str = Query(default="550e8400-0001"),
    scenario: str = Query(default="fault", description="fault | success"),
) -> dict:
    return _TUNNEL_STATUS_OK if scenario == "success" else _TUNNEL_STATUS_FAULT


@app.post("/ncm/api/v2/reboot_activity/")
def reset_modem(body: RebootActivityRequest) -> dict:
    router_id = body.router.rstrip("/").split("/")[-1]
    return {
        "id": "reboot-001",
        "router": body.router,
        "status": "pending",
        "created_at": "2026-05-16T09:15:00Z",
        "message": f"Router {router_id} reboot queued via NCM. Modem reconnect expected within 60s.",
    }


@app.patch("/ncm/api/v2/configuration_managers/{router_id}/")
def apply_mtu_fix(
    router_id: str = Path(...),
    body: MtuFixRequest = MtuFixRequest(),
) -> dict:
    return {
        "id": "cfg-001",
        "router": f"/api/v2/routers/{router_id}/",
        "success": True,
        "mtu_applied": body.mtu,
        "mss_clamping": body.mss_clamping,
        "mss_clamp_value": body.mss_clamp_value,
        "message": (
            f"MTU set to {body.mtu} with MSS clamping at {body.mss_clamp_value}. "
            "Config pushed via NCM. Tunnel renegotiation in progress."
        ),
    }
