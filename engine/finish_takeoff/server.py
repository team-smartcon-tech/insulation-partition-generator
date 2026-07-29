# -*- coding: utf-8 -*-
"""
엔진 HTTP API — UI(오토콘 웹)가 호출하는 유일한 접점.

**표준 라이브러리만 사용한다** (fastapi/uvicorn 미설치 환경에서도 그대로 뜬다).

    python -m finish_takeoff.server            # 기본 127.0.0.1:8901
    python -m finish_takeoff.server --port 9000

엔드포인트
    GET  /health
    POST /analyze          DXF 업로드 → 레이어 분석 + 프리셋 초안
    POST /trace            클릭점 → 실 추적 (벡터 우선, 실패 시 래스터 폴백)
    POST /takeoff          실 폴리곤들 → 마감 물량
    POST /registry/rule    규칙 → 세대 대장 생성
    POST /registry/paste   Excel 붙여넣기 → 세대 대장
    POST /billing/parse    범위 문자열 → 매칭 세대 미리보기
    POST /billing/compute  진도 → 기성 산출 + 검증

세션(도면)은 메모리에 보관한다. 프로덕션에서는 Storage/DB 어댑터로 교체한다.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import tempfile
import traceback
import uuid
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

from .billing import parser as range_parser
from .billing.progress import (
    DEFAULT_WORK_TYPES,
    BillingPeriod,
    Progress,
    ProgressStore,
    UnitQuantity,
    compute_billing,
    lock_period,
)
from .billing.validator import validate
from .dxf import entities as entity_mod
from .dxf import layers as layer_mod
from .dxf.loader import DxfLoadError, load
from .geometry import cleanup, polygonize, raster_fill
from .models import LayerRole
from .registry.units import UnitRegistry
from .takeoff import openings as opening_mod
from .takeoff import rules as takeoff_rules

log = logging.getLogger(__name__)

#: 세션 저장소 — {session_id: {...}}
_SESSIONS: dict[str, dict[str, Any]] = {}


# ═══════════════════════════════════════════════════════════
# 핸들러 로직
# ═══════════════════════════════════════════════════════════


def _analyze(body: dict) -> dict:
    """DXF(base64) → 레이어 분석 + 프리셋 초안 + 세션 생성."""
    raw = base64.b64decode(body["dxf_base64"])
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as f:
        f.write(raw)
        path = f.name

    doc, info = load(path, unit_override=body.get("unit"))
    stats = layer_mod.analyze(doc, info.unit_scale_to_mm)
    preset = layer_mod.suggest_preset(stats)

    sid = uuid.uuid4().hex[:12]
    _SESSIONS[sid] = {"doc": doc, "info": info, "stats": stats, "preset": preset,
                      "segments": None, "index": None, "rooms": []}

    walls = [
        {"layer": s.normalized, "lines": s.line_count,
         "median_mm": round(s.median_line_length_mm), "score": round(score), "why": why}
        for s, score, why in layer_mod.wall_candidates(stats, top=5)
    ]
    return {
        "session": sid,
        "drawing": {
            "insunits": info.insunits, "unit_scale": info.unit_scale_to_mm,
            "unit_source": info.unit_source, "entities": info.entity_count,
            "layers": info.layer_count, "layers_with_entities": len(stats),
            "bbox_mm": list(info.bbox_mm), "is_large": info.is_large,
            "max_insert_depth": info.max_insert_depth,
            "mirrored_inserts": info.mirrored_insert_count,
            "unresolved_xref": info.has_unresolved_xref,
        },
        "wall_candidates": walls,
        "preset": {r.value: v for r, v in preset.roles.items()},
        "top_layers": [
            {"layer": s.normalized, "total": s.total, "lines": s.line_count,
             "median_mm": round(s.median_line_length_mm)}
            for s in stats[:25]
        ],
    }


def _prepare(sess: dict, roles: Optional[list[str]] = None) -> None:
    """세션에 경계 선분·폐합 인덱스를 준비한다 (최초 1회)."""
    if sess.get("segments") is not None:
        return
    doc, info, stats, preset = sess["doc"], sess["info"], sess["stats"], sess["preset"]
    use = [LayerRole(r) for r in (roles or ["wall", "door", "window", "wall_finish"])]
    lay: set[str] = set()
    for r in use:
        lay |= set(layer_mod.find_role_layers(stats, preset, r))
    segs, _ = entity_mod.extract_segments(doc, info.unit_scale_to_mm, layers=lay)

    # 문 스윙 ARC → 개구부 폐합선
    door_layers = set(layer_mod.find_role_layers(stats, preset, LayerRole.DOOR))
    closures = opening_mod.collect(doc, info.unit_scale_to_mm, segs,
                                   door_layers=door_layers, use_gap_fallback=False)
    all_segs = segs + [c.as_segment() for c in closures]

    res = cleanup.clean(all_segs)
    sess["segments"] = all_segs
    sess["index"] = polygonize.build(res.lines)
    sess["closures"] = closures
    sess["bridges"] = res.bridged_gaps


def _trace(body: dict) -> dict:
    """클릭점 → 실 추적. 벡터 우선, 실패 시 래스터 폴백."""
    sess = _SESSIONS[body["session"]]
    _prepare(sess, body.get("roles"))
    click = (float(body["x"]), float(body["y"]))

    r = polygonize.trace_at(sess["index"], click)
    method = "vector"
    poly = r.polygon
    warnings = [{"code": w.code, "message": w.message} for w in r.warnings]

    if poly is None and body.get("allow_raster", True):
        rr = raster_fill.trace(
            sess["segments"], click,
            window_mm=float(body.get("window_mm", 20000)),
            res_mm=float(body.get("res_mm", 10)),
        )
        poly = rr.polygon
        method = "raster"
        warnings = [{"code": w.code, "message": w.message} for w in rr.warnings]
        if poly is None:
            return {"ok": False, "method": method, "warnings": warnings,
                    "touched_border": rr.touched_border}

    if poly is None:
        return {"ok": False, "method": method, "warnings": warnings}

    ext, holes = polygonize.polygon_to_points(poly)
    room = {
        "ok": True, "method": method,
        "area_m2": round(poly.area / 1e6, 3),
        "perimeter_m": round(poly.exterior.length / 1000, 3),
        "polygon": [[round(x, 1), round(y, 1)] for x, y in ext],
        "holes": [[[round(x, 1), round(y, 1)] for x, y in h] for h in holes],
        "click": list(click),
        "is_approximate": method == "raster",
        "warnings": warnings,
    }
    sess["rooms"].append({"polygon": poly, "name": body.get("name", ""),
                          "approx": method == "raster"})
    return room


def _takeoff(body: dict) -> dict:
    """실 목록 → 마감 물량."""
    st = takeoff_rules.TakeoffSettings(**body.get("settings", {}))
    from shapely.geometry import Polygon

    rooms = []
    for r in body["rooms"]:
        poly = Polygon([(p[0], p[1]) for p in r["polygon"]],
                       [[(p[0], p[1]) for p in h] for h in r.get("holes", [])])
        ops = [takeoff_rules.OpeningSpec(o["width_mm"], o["height_mm"], o.get("kind", "door"))
               for o in r.get("openings", [])]
        rooms.append(takeoff_rules.compute(
            room_name=r.get("name", "실"), polygon=poly, openings=ops, settings=st,
            ceiling_height_mm=r.get("ceiling_height_mm"),
            is_approximate=bool(r.get("is_approximate")),
        ))

    agg = takeoff_rules.summarize(rooms)
    return {
        "rooms": [
            {"name": rm.room_name, "area_m2": round(rm.area_m2, 2),
             "pyeong": round(rm.pyeong, 2), "perimeter_m": round(rm.perimeter_m, 2),
             "is_approximate": rm.is_approximate,
             "lines": [{"kind": l.kind.value, "raw": round(l.raw, 2),
                        "with_waste": round(l.with_waste, 2), "unit": l.unit,
                        "count": l.count, "note": l.note} for l in rm.lines]}
            for rm in rooms
        ],
        "summary": [
            {"kind": k.value, "raw": round(v.raw, 2), "with_waste": round(v.with_waste, 2),
             "unit": v.unit, "count": v.count} for k, v in agg.items()
        ],
        "total_area_m2": round(sum(r.area_m2 for r in rooms), 2),
    }


def _registry_from_rule(body: dict) -> dict:
    reg = UnitRegistry.from_rule(
        body["buildings"], int(body["floor_from"]), int(body["floor_to"]),
        body["line_types"],
        exclude_floors=body.get("exclude_floors", []),
        exclude_units=body.get("exclude_units", []),
    )
    return _reg_payload(reg)


def _registry_from_paste(body: dict) -> dict:
    reg, errors = UnitRegistry.from_paste(body["text"])
    out = _reg_payload(reg)
    out["errors"] = errors
    return out


def _reg_payload(reg: UnitRegistry) -> dict:
    return {
        "count": len(reg),
        "type_counts": reg.type_counts(),
        "buildings": reg.buildings,
        "units": [{"key": u.key, "building": u.building, "floor": u.floor,
                   "unit_no": u.unit_no, "line": u.line, "unit_type": u.unit_type}
                  for u in reg],
    }


def _payload_to_registry(units: list[dict]) -> UnitRegistry:
    from .registry.units import UnitInstance

    reg = UnitRegistry()
    for u in units:
        reg.add(UnitInstance(u["building"], int(u["floor"]), u["unit_no"],
                             u["line"], u["unit_type"]))
    return reg


def _billing_parse(body: dict) -> dict:
    """범위 문자열 → 미리보기. **확인 전 적용하지 않는다.**"""
    reg = _payload_to_registry(body["units"])
    res = range_parser.parse(body["text"], reg)
    return {
        "ok": res.ok,
        "summary": res.summary(),
        "count": res.count,
        "errors": [{"line": e.line_no, "token": e.token, "message": e.message}
                   for e in res.errors],
        "missing": res.missing,
        "matched": [{"key": u.key, "building": u.building, "floor": u.floor,
                     "unit_no": u.unit_no, "unit_type": u.unit_type, "ratio": r}
                    for u, r in res.matched],
    }


def _billing_compute(body: dict) -> dict:
    """진도 → 기성 산출 + 검증."""
    reg = _payload_to_registry(body["units"])
    store = ProgressStore()
    for p in body.get("progress", []):
        store.set(Progress(int(p["period"]), p["unit_key"], p["work"], float(p["ratio"])))

    quantities = {
        t: UnitQuantity(t, by_work=dict(v.get("by_work", {})),
                        contract_by_work=dict(v.get("contract", {})), rev=v.get("rev", ""))
        for t, v in body.get("quantities", {}).items()
    }

    def mk(d: dict) -> BillingPeriod:
        return BillingPeriod(int(d["seq"]), d.get("title", f"{d['seq']}차"),
                             date.fromisoformat(d.get("cutoff", date.today().isoformat())),
                             is_locked=bool(d.get("locked")))

    period = mk(body["period"])
    prev = mk(body["prev_period"]) if body.get("prev_period") else None
    if prev and body.get("prev_snapshot"):
        prev.snapshot = dict(body["prev_snapshot"])
        prev.is_locked = True

    res = compute_billing(period=period, registry=reg, store=store,
                          quantities=quantities, prev_period=prev,
                          prefer_contract=bool(body.get("prefer_contract", True)))
    rep = validate(period=period, result=res, registry=reg, store=store,
                   quantities=quantities, prev_period=prev)

    return {
        "by_work": res.by_work(),
        "by_building": res.by_building(),
        "lines": [
            {"unit": l.unit.key, "building": l.unit.building, "floor": l.unit.floor,
             "unit_no": l.unit.unit_no, "type": l.unit.unit_type,
             "work": l.work.code, "work_name": l.work.name,
             "unit_qty": round(l.unit_qty, 3), "prev_ratio": l.prev_ratio,
             "cum_ratio": l.cum_ratio, "current": round(l.current_qty, 3),
             "cum": round(l.cum_qty, 3), "remain": round(l.remain_qty, 3)}
            for l in res.lines
        ],
        "validation": {
            "can_lock": rep.can_lock,
            "summary": rep.summary(),
            "issues": [{"severity": i.severity.value, "code": i.code,
                        "message": i.message, "unit": i.unit_key, "work": i.work_code}
                       for i in rep.issues],
        },
        "works": [{"code": w.code, "name": w.name} for w in DEFAULT_WORK_TYPES],
    }


ROUTES = {
    "/analyze": _analyze,
    "/trace": _trace,
    "/takeoff": _takeoff,
    "/registry/rule": _registry_from_rule,
    "/registry/paste": _registry_from_paste,
    "/billing/parse": _billing_parse,
    "/billing/compute": _billing_compute,
}


class Handler(BaseHTTPRequestHandler):
    server_version = "FinishTakeoff/0.1"

    def _send(self, code: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "sessions": len(_SESSIONS)})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        fn = ROUTES.get(self.path)
        if fn is None:
            self._send(404, {"error": f"알 수 없는 경로: {self.path}"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            self._send(200, fn(body))
        except DxfLoadError as e:
            self._send(400, {"error": str(e)})
        except KeyError as e:
            self._send(400, {"error": f"필수 항목 누락: {e}"})
        except Exception as e:  # pragma: no cover
            log.error("요청 처리 실패 %s: %s\n%s", self.path, e, traceback.format_exc())
            self._send(500, {"error": str(e)})

    def log_message(self, fmt: str, *args: Any) -> None:
        log.info("%s %s", self.address_string(), fmt % args)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="마감 물량 산출 엔진 API")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8901)
    ns = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
    srv = ThreadingHTTPServer((ns.host, ns.port), Handler)
    log.info("엔진 API 기동 http://%s:%d", ns.host, ns.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
