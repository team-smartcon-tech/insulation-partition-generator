# -*- coding: utf-8 -*-
"""
형상 회귀 테스트 — 실제로 발생한 버그를 고정한다.

배경: 실 형상을 바운딩박스로 대체하거나, '직교화'를 형상 단순도형화로
구현하면 L자형이 사각형이 되어 면적이 과다 산출된다. 아래 6종은 그것을 막는다.

직교화의 정의: 각 변을 **개별적으로** 가장 가까운 축에 정렬하는 것.
정점 수를 줄이거나 형상을 치환하는 것이 아니다. L자형은 직교화 후에도 L자형이다.
"""
from __future__ import annotations

import math

import pytest
from shapely.geometry import Polygon

from finish_takeoff.space.refine import orthogonalize, simplify_outline


def _bbox_area(poly: Polygon) -> float:
    minx, miny, maxx, maxy = poly.bounds
    return (maxx - minx) * (maxy - miny)


def _ring(poly: Polygon) -> list[tuple[float, float]]:
    """닫힘 중복점을 뺀 외곽 정점."""
    pts = list(poly.exterior.coords)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


# ── 1. L자형 ────────────────────────────────────────────────
def test_l_shape_keeps_six_vertices_and_area():
    """L자형 → 정점 6개, 면적 정확, BBox 면적보다 작아야 한다."""
    l_shape = Polygon([(0, 0), (4000, 0), (4000, 2000),
                       (2000, 2000), (2000, 4000), (0, 4000)])
    out = orthogonalize(simplify_outline(l_shape))

    assert len(_ring(out)) == 6, "L자형 정점이 6개가 아니다 — 형상이 뭉개졌다"
    # 4×4 - 2×2 = 12㎡ (mm² 기준 12e6)
    assert out.area == pytest.approx(12_000_000, rel=1e-6)
    assert out.area < _bbox_area(out), "면적이 BBox 와 같다 — 바운딩박스로 대체됐다"


# ── 2. ㄷ자형 ───────────────────────────────────────────────
def test_u_shape_keeps_eight_vertices():
    """ㄷ자형 → 정점 8개 유지."""
    u_shape = Polygon([(0, 0), (5000, 0), (5000, 4000), (4000, 4000),
                       (4000, 1500), (1000, 1500), (1000, 4000), (0, 4000)])
    out = orthogonalize(simplify_outline(u_shape))

    assert len(_ring(out)) == 8, "ㄷ자형 정점이 8개가 아니다"
    assert out.area < _bbox_area(out)


# ── 3. 도넛형 ───────────────────────────────────────────────
def test_donut_keeps_hole_and_deducts_area():
    """도넛형 → 외곽링 + 홀 보존, 홀 면적이 공제되어야 한다."""
    donut = Polygon(
        [(0, 0), (6000, 0), (6000, 6000), (0, 6000)],
        [[(2000, 2000), (4000, 2000), (4000, 4000), (2000, 4000)]],
    )
    out = orthogonalize(simplify_outline(donut))

    assert len(out.interiors) == 1, "홀이 사라졌다"
    # 6×6 - 2×2 = 32㎡
    assert out.area == pytest.approx(32_000_000, rel=1e-6)


# ── 4. 45° 사선벽 ───────────────────────────────────────────
def test_diagonal_wall_is_not_snapped_to_axis():
    """45° 사선 변이 축에 정렬되면 안 된다 — 사선은 사선으로 유지."""
    diag = Polygon([(0, 0), (4000, 0), (4000, 2000), (2000, 4000), (0, 4000)])
    out = orthogonalize(simplify_outline(diag))

    pts = _ring(out)
    # 어느 변이든 45°(±10°) 를 유지하는 변이 하나는 있어야 한다
    found = False
    for i in range(len(pts)):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % len(pts)]
        ang = math.degrees(math.atan2(abs(y2 - y1), abs(x2 - x1)))
        if 35.0 <= ang <= 55.0:
            found = True
            break
    assert found, "사선 변이 축에 강제 정렬됐다"


# ── 5. 정사각형 ─────────────────────────────────────────────
def test_square_keeps_four_vertices_and_exact_area():
    """정사각형 → 정점 4개, 면적 오차 0.01% 이내."""
    sq = Polygon([(0, 0), (3000, 0), (3000, 3000), (0, 3000)])
    out = orthogonalize(simplify_outline(sq))

    assert len(_ring(out)) == 4
    assert out.area == pytest.approx(9_000_000, rel=1e-4)


# ── 6. 계단형 요철 50mm ─────────────────────────────────────
def test_small_step_is_not_simplified_away():
    """50mm 요철이 단순화로 사라지면 안 된다 (epsilon 5mm 기준)."""
    stepped = Polygon([
        (0, 0), (3000, 0), (3000, 1000),
        (3050, 1000), (3050, 2000),      # 50mm 튀어나온 요철
        (3000, 2000), (3000, 3000), (0, 3000),
    ])
    out = orthogonalize(simplify_outline(stepped))

    pts = _ring(out)
    assert len(pts) >= 8, "요철이 단순화로 사라졌다 (정점 %d개)" % len(pts)
    xs = [p[0] for p in pts]
    assert max(xs) == pytest.approx(3050, abs=5), "요철 끝(3050mm)이 사라졌다"


# ── 금지 API 사용 여부 (정적 검사) ──────────────────────────
def test_no_bounding_box_shortcuts_in_shape_path():
    """실 형상 산출 경로에서 bounds/envelope/minAreaRect 를 쓰지 않는다."""
    from pathlib import Path

    # 실제 **호출**만 잡는다. 주석·docstring 의 '쓰지 마라' 문구는 위반이 아니다.
    banned = (".minimum_rotated_rectangle", ".envelope",
              "minAreaRect(", "boundingRect(")
    src_dir = Path(__file__).resolve().parent.parent / "finish_takeoff" / "space"
    hits: list[str] = []
    for py in src_dir.glob("*.py"):
        in_doc = False
        for lineno, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            # 삼중따옴표 docstring 토글 (한 줄 docstring 도 처리)
            if stripped.count('"""') == 1:
                in_doc = not in_doc
                continue
            if in_doc or stripped.startswith("#"):
                continue
            code = line.split("#", 1)[0]
            for token in banned:
                if token in code:
                    hits.append(f"{py.name}:{lineno} {token}")
    assert not hits, "형상 경로에 바운딩박스 지름길이 있다: %s" % hits
