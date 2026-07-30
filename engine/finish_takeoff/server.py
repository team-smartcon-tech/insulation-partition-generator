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

# 실 자동 인식 — 축정렬 판정/최소 실 크기 기준 (하드코딩된 레이어명 대신 형상 기준)
_AXIS_TOL_MM = 1.0          # 이 이하 편차면 수직·수평으로 본다
_AXIS_MIN_LEN_MM = 150.0    # 이보다 짧은 선은 기호·해칭으로 보고 경계에서 제외
_ROOM_MIN_SIDE_MM = 700.0   # 한 변이 이보다 작으면 실이 아니라 벽 사이 틈
_BOUNDARY_LAYER_MIN_MM = 40.0   # (폴백) 규격 레이어명이 아닐 때 쓰는 최소 중앙값
# 경계로 쓸 요소코드 — 벽(WA)·개구부(DW)·골조
_BOUNDARY_LAYER_ALLOW = ("WAXM", "WAXS", "DWXM", "골조", "WALL", "벽")
# 실 안쪽을 잘게 자르는 것들 — 위생기구·가구·타일패턴·해칭·단열재·치수
_BOUNDARY_LAYER_DENY = (
    "INS", "PATT", "PAT1", "HAT", "FUR", "SANI", "CLEN", "DRAIN",
    "치수", "난간", "TEXT", "DIM",
)
_ROOM_MERGE_OVERLAP = 0.85      # 이 비율 이상 겹쳐야 같은 트인 공간(LDK)으로 보고 병합
# 벽 두께 범위 — 이 간격으로 평행한 선 쌍만 벽으로 인정한다 (타일 줄눈·가구선 제거)
_WALL_THICKNESS_MIN_MM = 70.0
_WALL_THICKNESS_MAX_MM = 400.0
_WALL_PAIR_MIN_OVERLAP_MM = 300.0
# 쌍을 못 이뤄도 이보다 길면 경계로 인정한다 — 홑겹으로 그린 경량벽체가 빠지는 것을 막는다
_SINGLE_LINE_KEEP_MM = 1200.0
# 실 윤곽 채움 — 창 크기/해상도. 창이 크면 느리고, 작으면 큰 실이 잘린다.
_FILL_WINDOW_MM = 14000.0
_FILL_RES_MM = 20.0
# 채움 결과를 레이캐스트 상자와 대조하는 허용 범위 (밖이면 채움을 버린다)
_FILL_MIN_RATIO = 0.35
_FILL_MAX_RATIO = 1.05
# 등간격 격자(타일 줄눈) 판정 — 이 간격 이상으로 3줄 이상 나란하면 벽이 아니다
_GRID_MIN_PITCH_MM = 80.0
_GRID_PITCH_TOL_MM = 15.0
# 클릭을 실명으로 스냅하는 최대 거리 — 이보다 멀면 실명 없는 공간으로 본다
_LABEL_SNAP_MM = 4000.0
# 실명 주변 표본점 — 문 개구부와 같은 선상에 놓인 라벨 때문에 광선이 새는 것을 막는다
_CAST_OFFSETS_MM = (
    (0.0, 0.0),
    (-600.0, 0.0), (600.0, 0.0), (0.0, -600.0), (0.0, 600.0),
    (-400.0, -400.0), (400.0, -400.0), (-400.0, 400.0), (400.0, 400.0),
)

ROOM_WORDS = (
    "거실", "침실", "안방", "주방", "식당", "욕실", "화장실", "현관", "드레스",
    "팬트리", "발코니", "다용도", "알파", "서재", "복도", "창고",
)

class SessionExpired(Exception):
    """세션이 만료/유실됨 — 클라이언트가 도면을 다시 분석해야 한다."""


def _session(body: dict) -> dict:
    """세션을 꺼낸다. 없으면 원인이 분명한 예외를 던진다."""
    sid = body.get("session")
    if not sid:
        raise KeyError("session")
    sess = _SESSIONS.get(sid)
    if sess is None:
        raise SessionExpired("도면 세션이 만료되었습니다. 도면을 다시 불러오세요.")
    return sess


#: 파싱 결과 캐시 — {sha256: (doc, info, stats, preset)}
#: 92MB 도면은 readfile 만 10초가 걸린다. 같은 파일을 다시 열 때는 즉시 응답한다.
_DOC_CACHE: dict[str, tuple] = {}


# ═══════════════════════════════════════════════════════════
# 핸들러 로직
# ═══════════════════════════════════════════════════════════


def _analyze_bytes(raw: bytes, unit: Optional[str] = None) -> dict:
    """
    DXF 원문 → 레이어 분석 + 프리셋 초안 + 세션 생성.

    같은 파일(해시 일치)은 파싱 결과를 재사용한다 — 92MB 도면 기준 10초 → 즉시.
    """
    import hashlib
    import time as _t

    digest = hashlib.sha256(raw).hexdigest()
    cached = _DOC_CACHE.get(digest)
    if cached:
        doc, info, stats, preset = cached
        log.info("[analyze] 캐시 적중 %s (%.1fMB)", digest[:8], len(raw) / 1048576)
    else:
        t0 = _t.perf_counter()
        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as f:
            f.write(raw)
            path = f.name
        doc, info = load(path, unit_override=unit)
        stats = layer_mod.analyze(doc, info.unit_scale_to_mm)
        preset = layer_mod.suggest_preset(stats)
        _DOC_CACHE[digest] = (doc, info, stats, preset)
        log.info("[analyze] 신규 파싱 %s (%.1fMB) %.2fs",
                 digest[:8], len(raw) / 1048576, _t.perf_counter() - t0)

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
        "cached": bool(cached),
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
    # 경계는 **벽체만** 쓴다. 마감선·창호 대각선·X 표시 같은 선이 섞이면
    # 그 대각선이 실을 삼각형으로 잘라버린다(실측 확인).
    # 문 개구부는 아래에서 폐합선으로만 막는다.
    use = [LayerRole(r) for r in (roles or ["wall"])]
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


def _boundary_layers(stats: list) -> set[str]:
    """
    실 경계로 쓸 레이어를 **요소코드**로 고른다.

    이 도면의 레이어명은 `AA-WAXM-CONC` 처럼 `분야-요소-재료` 규격이다.
    벽(WA)·개구부(DW)만 경계로 쓰고, 실 안쪽을 잘게 자르는 것들은 배제한다:
      · `AA-FUR-BATH`(위생기구 3,936선), `AA-FFXM-SANI` → 욕실을 기구 크기로 자름
      · `AA-XXXX-PATT` / `PAT1`(타일 패턴), `AA-MKXH-HAT`(해칭) → 실을 타일 칸으로 자름
      · `AA-WAXS-INS` / `AA-XXXX-INS`(단열재 40,000선) → 벽 표면 잡선
    길이·평행쌍 같은 형상 기준만으로는 300mm 타일 격자와 300mm 두께 벽을
    구분할 수 없어서(실측 확인), 레이어 의미를 먼저 쓰는 것이 정확하고 빠르다.
    """
    keep: set[str] = set()
    for s in stats:
        if s.line_count <= 0:
            continue
        n = s.normalized.upper()
        if any(bad in n for bad in _BOUNDARY_LAYER_DENY):
            continue
        if any(tok in n for tok in _BOUNDARY_LAYER_ALLOW):
            keep.add(s.name)
    # 규격 레이어명이 아닌 도면(직접 그린 도면 등)은 형상 기준으로 되돌린다
    if not keep:
        keep = {
            s.name for s in stats
            if s.line_count > 0 and s.median_line_length_mm >= _BOUNDARY_LAYER_MIN_MM
        }
    return keep


def _boundary_lines(sess: dict) -> tuple[list, list]:
    """
    실 경계용 **축정렬** 선분을 (수직, 수평) 으로 나눠 캐시한다.

    골조벽 레이어만 쓰면 경량벽·건식벽이 빠져 실이 닫히지 않고,
    전 레이어를 그대로 쓰면 문 스윙 호·X 표시·계단 같은 **대각선**이
    실을 삼각형으로 잘라버린다(실측 확인). 아파트 실 경계는 사실상 전부
    수직·수평이므로 축정렬 선분만 남기면 두 문제가 동시에 사라진다.
    """
    if sess.get("axis_v") is not None:
        return sess["axis_v"], sess["axis_h"]

    doc, info, stats = sess["doc"], sess["info"], sess["stats"]
    lay = _boundary_layers(stats)
    segs, _ = entity_mod.extract_segments(doc, info.unit_scale_to_mm, layers=lay)

    v: list[tuple[float, float, float]] = []   # (x, y0, y1)
    h: list[tuple[float, float, float]] = []   # (y, x0, x1)
    for (x1, y1), (x2, y2) in segs:
        dx, dy = abs(x1 - x2), abs(y1 - y2)
        if dx <= _AXIS_TOL_MM and dy >= _AXIS_MIN_LEN_MM:
            v.append((x1, min(y1, y2), max(y1, y2)))
        elif dy <= _AXIS_TOL_MM and dx >= _AXIS_MIN_LEN_MM:
            h.append((y1, min(x1, x2), max(x1, x2)))

    v = _keep_wall_pairs(v)
    h = _keep_wall_pairs(h)

    # 윤곽 따기(래스터)용 원본 선분 + **문 개구부 폐합선**.
    # 개구부를 막지 않으면 채움이 문틈으로 새어 옆 실까지 한 덩어리가 된다
    # (드레스룸이 안방까지 먹은 사례).
    axis_segs = (
        [((c, a), (c, b)) for c, a, b in v] + [((a, c), (b, c)) for c, a, b in h]
    )
    preset = sess["preset"]
    door_layers = set(layer_mod.find_role_layers(stats, preset, LayerRole.DOOR))
    try:
        closures = opening_mod.collect(
            doc, info.unit_scale_to_mm, axis_segs,
            door_layers=door_layers, use_gap_fallback=False,
        )
        axis_segs += [c.as_segment() for c in closures]
        log.info("[경계] 문 폐합선 %d개 추가", len(closures))
    except Exception as e:   # 개구부 검출 실패해도 벽선만으로 진행한다
        log.warning("[경계] 문 폐합선 생성 실패: %s", e)

    sess["axis_segments"] = axis_segs
    sess["axis_v"], sess["axis_h"] = v, h
    log.info("[경계] 벽선 수직 %d · 수평 %d (레이어 %d개)", len(v), len(h), len(lay))
    return v, h


def _keep_wall_pairs(lines: list) -> list:
    """
    **평행 쌍을 이루는 선만** 남긴다 — 벽은 두께만큼 떨어진 두 줄로 그려진다.

    욕실 타일 줄눈, 가구·위생기구 외곽선은 홀선이라 이 검사에서 걸러진다.
    (걸러내지 않으면 욕실이 타일 한 칸 크기 1.2㎡ 로 잡힌다 — 실측 확인)
    좌표로 정렬해 이웃만 보므로 O(n log n) 이다. 이중 루프를 쓰지 않는다.
    """
    if not lines:
        return lines
    order = sorted(range(len(lines)), key=lambda i: lines[i][0])
    keep = [False] * len(lines)

    for oi, idx in enumerate(order):
        c0, a0, b0 = lines[idx]
        # 오른쪽(좌표 증가) 이웃만 보고, 쌍이 성립하면 양쪽 모두 남긴다
        for oj in range(oi + 1, len(order)):
            jdx = order[oj]
            c1, a1, b1 = lines[jdx]
            gap = c1 - c0
            if gap > _WALL_THICKNESS_MAX_MM:
                break
            if gap < _WALL_THICKNESS_MIN_MM:
                continue
            # 길이 방향으로 실제 겹쳐야 같은 벽의 양면이다
            if min(b0, b1) - max(a0, a1) >= _WALL_PAIR_MIN_OVERLAP_MM:
                keep[idx] = keep[jdx] = True

    # 쌍을 못 이뤘어도 충분히 긴 선은 남긴다 — 홑겹으로 그린 경량벽체가
    # 통째로 빠지면 채움이 옆 실로 새어나간다(실측 확인).
    kept = [
        ln for ln, k in zip(lines, keep)
        if k or (ln[2] - ln[1]) >= _SINGLE_LINE_KEEP_MM
    ]
    kept = _drop_grid_lines(kept)
    return kept if kept else lines


def _drop_grid_lines(lines: list) -> list:
    """
    등간격으로 **3줄 이상** 늘어선 선(타일 줄눈·격자 해칭)을 걸러낸다.

    300×300 타일의 줄눈 간격은 300mm 로, 300mm 두께 벽의 양면과 구분이 안 된다.
    그대로 두면 욕실이 타일 한 칸(0.1~1㎡)으로 잡힌다(실측 확인).
    진짜 벽은 평행선이 2줄뿐이지만 타일은 같은 간격으로 계속 이어진다는 점을 쓴다.
    """
    if len(lines) < 3:
        return lines
    order = sorted(range(len(lines)), key=lambda i: lines[i][0])
    drop = set()

    for oi in range(1, len(order) - 1):
        prev, cur, nxt = lines[order[oi - 1]], lines[order[oi]], lines[order[oi + 1]]
        g1, g2 = cur[0] - prev[0], nxt[0] - cur[0]
        if g1 < _GRID_MIN_PITCH_MM or g2 < _GRID_MIN_PITCH_MM:
            continue
        if g1 > _WALL_THICKNESS_MAX_MM or g2 > _WALL_THICKNESS_MAX_MM:
            continue
        if abs(g1 - g2) > _GRID_PITCH_TOL_MM:
            continue
        # 세 줄이 길이 방향으로도 겹쳐야 같은 격자다
        lo = max(prev[1], cur[1], nxt[1])
        hi = min(prev[2], cur[2], nxt[2])
        if hi - lo >= _WALL_PAIR_MIN_OVERLAP_MM:
            drop.update({order[oi - 1], order[oi], order[oi + 1]})

    return [ln for i, ln in enumerate(lines) if i not in drop]


def _cast_room(v: list, h: list, px: float, py: float) -> Optional[tuple]:
    """
    실명 위치에서 상·하·좌·우로 광선을 쏴 가장 가까운 벽선을 찾는다.

    래스터 채움과 달리 **새어나갈 수가 없다** — 네 방향 모두 벽을 만나야만
    실로 인정하고, 하나라도 못 만나면 실패로 둔다(임의 면적 금지).
    """
    left = right = down = up = None
    for x, y0, y1 in v:
        if y0 - _AXIS_TOL_MM <= py <= y1 + _AXIS_TOL_MM:
            if x < px and (left is None or x > left):
                left = x
            elif x > px and (right is None or x < right):
                right = x
    for y, x0, x1 in h:
        if x0 - _AXIS_TOL_MM <= px <= x1 + _AXIS_TOL_MM:
            if y < py and (down is None or y > down):
                down = y
            elif y > py and (up is None or y < up):
                up = y
    if None in (left, right, down, up):
        return None
    if (right - left) < _ROOM_MIN_SIDE_MM or (up - down) < _ROOM_MIN_SIDE_MM:
        return None
    return left, right, down, up


def _cast_room_robust(v: list, h: list, px: float, py: float) -> Optional[tuple]:
    """
    라벨 주변 여러 점에서 광선을 쏴 **가장 많이 나온** 영역을 채택한다.

    실명이 문 개구부와 같은 선상에 놓이면 광선이 그 틈으로 빠져나가
    옆 실까지 한 덩어리로 잡힌다(안방+욕실+드레스룸이 한 실로 잡힌 사례).
    개구부는 보통 한 곳뿐이라, 라벨을 조금씩 흔들어 쏘면 다수는 진짜 벽에 막힌다.
    """
    votes: dict[tuple, tuple] = {}
    counts: dict[tuple, int] = {}
    for dx, dy in _CAST_OFFSETS_MM:
        box = _cast_room(v, h, px + dx, py + dy)
        if box is None:
            continue
        key = tuple(round(c / 10) for c in box)   # 10mm 단위로 같은 영역 취급
        votes[key] = box
        counts[key] = counts.get(key, 0) + 1
    if not counts:
        return None
    # 최다 득표 → 동률이면 더 작은(더 많이 갇힌) 영역을 택한다
    best = max(
        counts,
        key=lambda k: (counts[k], -((votes[k][1] - votes[k][0]) * (votes[k][3] - votes[k][2]))),
    )
    return votes[best]


def _room_labels(sess: dict) -> list[tuple[str, float, float]]:
    """실명 텍스트 위치를 캐시한다 — (이름, x, y)."""
    if sess.get("room_labels") is not None:
        return sess["room_labels"]
    doc, info, stats, preset = sess["doc"], sess["info"], sess["stats"], sess["preset"]
    scale = info.unit_scale_to_mm
    label_layers = set(layer_mod.find_role_layers(stats, preset, LayerRole.ROOM_LABEL))
    out: list[tuple[str, float, float]] = []
    for e in doc.modelspace():
        if e.dxftype() not in ("TEXT", "MTEXT") or e.dxf.layer not in label_layers:
            continue
        try:
            txt = (e.dxf.text if e.dxftype() == "TEXT" else e.text).strip()
        except Exception:
            continue
        if any(w in txt for w in ROOM_WORDS):
            p = e.dxf.insert
            out.append((txt, p.x * scale, p.y * scale))
    sess["room_labels"] = out
    return out


def _snap_to_label(sess: dict, px: float, py: float) -> Optional[tuple[str, float, float]]:
    """
    클릭점에서 가장 가까운 실명으로 스냅한다.

    같은 실인데 클릭 위치에 따라 면적이 달라지면 못 쓴다(안방을 눌렀는데 50㎡).
    실명 위치를 기준점으로 통일하면 자동 인식과 항상 같은 결과가 나온다.
    도면 전체 자동 인식을 클릭마다 돌리면 45초가 걸려 그 방법은 쓸 수 없다.
    """
    best = None
    best_d2 = _LABEL_SNAP_MM * _LABEL_SNAP_MM
    for name, lx, ly in _room_labels(sess):
        d2 = (lx - px) ** 2 + (ly - py) ** 2
        if d2 < best_d2:
            best, best_d2 = (name, lx, ly), d2
    return best


def _room_at(sess: dict, px: float, py: float) -> Optional[dict]:
    """
    한 점에서 실 하나를 확정한다 — **채움 우선, 레이캐스트 보조**.

    채움(래스터)은 벽 단차·L자·작은 욕실까지 실제 형상 그대로 따낸다.
    레이캐스트 직사각형은 단차를 뭉개고("오른쪽 벽이 일자로 밀고 나감"),
    문 개구부가 있으면 옆 실까지 먹는다. 그래서 채움을 먼저 쓰고,
    채움이 새어나갔을 때만 레이캐스트 상자로 되돌린다.
    둘 다 실패하면 **면적을 지어내지 않고** 실패로 둔다.
    """
    v, h = _boundary_lines(sess)
    segs = sess["axis_segments"]
    box = _cast_room_robust(v, h, px, py)

    # 채움 창은 레이캐스트 상자에 맞춘다. 14m 고정으로 두면 실 하나당 1.3초가 걸려
    # 전체 자동 인식이 6분씩 걸린다(실측). 상자를 알면 그만큼만 칠하면 된다.
    if box is not None:
        span = max(box[1] - box[0], box[3] - box[2])
        window = min(_FILL_WINDOW_MM, span * 1.4 + 1000.0)
    else:
        window = _FILL_WINDOW_MM
    rr = raster_fill.trace(
        segs, (px, py), window_mm=window, res_mm=_FILL_RES_MM,
    )
    if rr.ok and rr.polygon is not None:
        poly = rr.polygon
        minx, miny, maxx, maxy = poly.bounds
        # 채움 결과를 레이캐스트 상자로 **검산**한다. 욕실 타일 줄눈처럼 실 안쪽에
        # 선이 있으면 채움이 한 칸에 갇혀 0.1㎡ 같은 값이 나오고, 개구부가 열려
        # 있으면 반대로 옆 실까지 먹는다. 상자 대비 터무니없으면 채움을 버린다.
        ok_vs_box = True
        if box is not None:
            box_area = (box[1] - box[0]) * (box[3] - box[2])
            ratio = poly.area / box_area if box_area > 0 else 0.0
            ok_vs_box = _FILL_MIN_RATIO <= ratio <= _FILL_MAX_RATIO
        if ok_vs_box:
            return {
                "polygon": [[round(x, 1), round(y, 1)] for x, y in poly.exterior.coords],
                "area_m2": round(poly.area / 1e6, 3),
                "perimeter_m": round(poly.exterior.length / 1000, 3),
                "width_mm": round(maxx - minx),
                "depth_mm": round(maxy - miny),
                "box": (minx, maxx, miny, maxy),
                "method": "fill",
                "is_approximate": True,   # 래스터 해상도 기준
            }

    if box is None:
        return None
    left, right, down, up = box
    return {
        "polygon": [[left, down], [right, down], [right, up], [left, up]],
        "area_m2": round((right - left) * (up - down) / 1e6, 3),
        "perimeter_m": round(2 * ((right - left) + (up - down)) / 1000, 3),
        "width_mm": round(right - left),
        "depth_mm": round(up - down),
        "box": box,
        "method": "raycast",
        "is_approximate": True,
    }


def _auto_rooms(body: dict) -> dict:
    """
    실명 텍스트를 기준으로 도면의 실을 **자동으로** 전부 잡는다.

    사용자가 실을 하나씩 클릭할 필요가 없다(대형 도면에서 확대·클릭 자체가 고통).
    `_sess` 로 세션을 직접 넘기면 내부 호출(클릭 시 지연 계산)로 쓴다.
    """
    sess = body.get("_sess") or _session(body)
    doc, info, stats, preset = sess["doc"], sess["info"], sess["stats"], sess["preset"]
    scale = info.unit_scale_to_mm
    v, h = _boundary_lines(sess)

    rooms, failed = [], []

    for txt, px, py in _room_labels(sess):
        got = _room_at(sess, px, py)
        if got is None:
            failed.append(txt)
            continue
        got["names"] = [txt]
        rooms.append(got)

    # 거실·주방/식당처럼 벽 없이 트인 공간(LDK)은 라벨마다 같은 영역이 잡힌다.
    # 그대로 두면 같은 바닥을 두 번 계상하므로 크게 겹치는 것끼리 하나로 합친다.
    merged: list[dict] = []
    for r in rooms:
        l1, r1, d1, u1 = r["box"]
        a1 = (r1 - l1) * (u1 - d1)
        for m in merged:
            l2, r2, d2, u2 = m["box"]
            ow = min(r1, r2) - max(l1, l2)
            oh = min(u1, u2) - max(d1, d2)
            if ow <= 0 or oh <= 0:
                continue
            if (ow * oh) / min(a1, (r2 - l2) * (u2 - d2)) >= _ROOM_MERGE_OVERLAP:
                # 더 큰 쪽(트인 공간 전체)을 남기고 이름만 합친다
                if a1 > (r2 - l2) * (u2 - d2):
                    m.update({k: r[k] for k in
                              ("polygon", "area_m2", "perimeter_m",
                               "width_mm", "depth_mm", "box", "method")})
                if r["names"][0] not in m["names"]:
                    m["names"].append(r["names"][0])
                break
        else:
            merged.append(dict(r))

    rooms = [{
        "name": "+".join(m["names"]),
        "area_m2": m["area_m2"],
        "width_mm": m["width_mm"],
        "depth_mm": m["depth_mm"],
        "polygon": m["polygon"],
        "is_approximate": m["is_approximate"],
        "method": m["method"],
        "merged": len(m["names"]) > 1,
    } for m in merged]
    rooms.sort(key=lambda r: -r["area_m2"])
    return {
        "rooms": rooms,
        "failed": failed,
        "total_area_m2": round(sum(r["area_m2"] for r in rooms), 2),
    }


def _trace(body: dict) -> dict:
    """클릭점 → 실 추적. 레이캐스트 → 벡터 폐합 → 래스터 순."""
    sess = _session(body)
    click = (float(body["x"]), float(body["y"]))

    # 클릭점을 가장 가까운 실명으로 스냅해 그 위치에서 계산한다.
    # (실명이 없는 공간은 클릭점 그대로 쓴다)
    snapped = _snap_to_label(sess, click[0], click[1])
    at = (snapped[1], snapped[2]) if snapped else click

    got = _room_at(sess, at[0], at[1])
    if got is not None:
        return {
            "ok": True, "method": got["method"],
            "area_m2": got["area_m2"], "perimeter_m": got["perimeter_m"],
            "polygon": got["polygon"], "holes": [], "click": list(click),
            "name": snapped[0] if snapped else None,
            "is_approximate": got["is_approximate"], "warnings": [],
        }

    _prepare(sess, body.get("roles"))
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


def _analyze(body: dict) -> dict:
    """JSON(base64) 경로 — 하위 호환. 대용량은 바이너리 경로를 쓴다."""
    return _analyze_bytes(base64.b64decode(body["dxf_base64"]), body.get("unit"))


ROUTES = {
    "/analyze": _analyze,
    "/trace": _trace,
    "/auto-rooms": _auto_rooms,
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
        # 대용량 DXF 는 base64 없이 원문 그대로 받는다 (92MB → base64 123MB 방지)
        if self.path == "/analyze-raw":
            try:
                n = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(n)
                unit = self.headers.get("X-Unit") or None
                self._send(200, _analyze_bytes(raw, unit))
            except DxfLoadError as e:
                self._send(400, {"error": str(e)})
            except Exception as e:  # pragma: no cover
                log.error("analyze-raw 실패: %s\n%s", e, traceback.format_exc())
                self._send(500, {"error": str(e)})
            return

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
        except SessionExpired as e:
            # 엔진을 재기동하면 메모리 세션이 사라진다. 클라이언트가 이 코드를 보고
            # 도면을 다시 분석하도록 안내한다 (그냥 "필수 항목 누락" 이면 원인을 모른다).
            self._send(409, {"error": str(e), "code": "session_expired"})
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
