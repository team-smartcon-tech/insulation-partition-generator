# -*- coding: utf-8 -*-
"""
현관문 폐합 — 세대 **밖으로 나가는** 통로만 막는다.

왜 필요한가
    현관은 공용홀과 현관문으로 이어져 있다. 다중 시드 분할은 실끼리 충돌하면
    자연히 갈라지지만, 공용홀 쪽에는 시드가 없으므로(코어부는 EXCLUDE)
    현관 영역이 홀·복도까지 퍼진다. 실측: 현관이 20.5㎡ / 17.3㎡ 로 나왔다
    (통상 3~5㎡).

무엇을 막고 무엇을 막지 않는가
    막는다   : 현관문 개구부 — 세대 경계를 넘는 통로
    막지 않는다: 실 사이 문·개방형 LDK — 여기는 시드 충돌로 갈라져야 한다
    실 사이 개구부에 가상 폐합선을 그리면 실제 벽과 구분이 사라져
    걸레받이·도배 물량이 틀어진다.
"""
from __future__ import annotations

import math
from typing import Iterable, Optional, Sequence

from shapely.geometry import LineString, Polygon

Point = tuple[float, float]


def find_entry_closures(doc, scale: float, entry_seeds: Sequence[Point], *,
                        door_layers: Optional[Iterable[str]] = None,
                        search_radius_mm: float = 2500.0,
                        thickness_mm: float = 300.0,
                        min_width_mm: float = 700.0,
                        max_width_mm: float = 1400.0) -> list[Polygon]:
    """
    현관 시드 근처의 문 스윙 호(ARC)를 찾아 그 **현(chord)** 을 장벽으로 만든다.

    문의 스윙 호는 반지름이 개구부 폭과 같고, 시작점·끝점이 문틀 양단이다.
    그 두 점을 잇는 선을 두께만큼 부풀려 장벽 폴리곤으로 쓴다.

    Args:
        doc: ezdxf Drawing.
        scale: 도면 단위 → mm 배율.
        entry_seeds: 현관 시드 좌표들 (mm).
        door_layers: 문 레이어. None 이면 전 레이어에서 ARC 를 본다.
        search_radius_mm: 현관 시드에서 이 거리 안의 문만 대상으로 한다.
        thickness_mm: 장벽 두께. 벽 두께 이상이어야 확실히 막힌다.
        min_width_mm, max_width_mm: 문으로 인정할 개구부 폭 범위.

    Returns:
        장벽 폴리곤 목록. 없으면 빈 목록 — 그 경우 현관 면적 경고로 넘긴다.
    """
    if not entry_seeds:
        return []
    allow = set(door_layers) if door_layers else None
    r2 = search_radius_mm * search_radius_mm
    out: list[Polygon] = []

    for e in doc.modelspace():
        if e.dxftype() != "ARC":
            continue
        if allow is not None and e.dxf.layer not in allow:
            continue
        try:
            cx, cy = e.dxf.center.x * scale, e.dxf.center.y * scale
            radius = e.dxf.radius * scale
            a0 = math.radians(e.dxf.start_angle)
            a1 = math.radians(e.dxf.end_angle)
        except Exception:
            continue
        if not (min_width_mm <= radius <= max_width_mm):
            continue
        # 현관 시드 근처인가
        if not any((cx - sx) ** 2 + (cy - sy) ** 2 <= r2 for sx, sy in entry_seeds):
            continue

        p0 = (cx + radius * math.cos(a0), cy + radius * math.sin(a0))
        p1 = (cx + radius * math.cos(a1), cy + radius * math.sin(a1))
        # 스윙 호의 현은 문틀 양단을 잇는다. 힌지(center)와 열린 끝을 잇는 변이
        # 아니라, 개구부를 가로지르는 쪽을 써야 한다 → center-p0, center-p1 중
        # 개구부에 해당하는 것은 두 점을 잇는 선이다.
        chord = LineString([p0, p1])
        if not (min_width_mm <= chord.length <= max_width_mm * 1.5):
            # 90° 호가 아니면 center 와 끝점을 잇는 변을 쓴다
            chord = LineString([(cx, cy), p1])
            if not (min_width_mm <= chord.length <= max_width_mm):
                continue
        out.append(chord.buffer(thickness_mm / 2.0, cap_style=2, join_style=2))

    return out
