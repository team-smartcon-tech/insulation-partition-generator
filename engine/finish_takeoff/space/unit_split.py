# -*- coding: utf-8 -*-
"""
S1 — 세대 경계 분리.

실 추적 **전에** 세대 단위로 영역을 격리한다. 이것이 없으면 한 층 평면에
84A/84B/84C 가 연속으로 붙어 있어 (1) 확장이 옆 세대로 누출되고
(2) 잡힌 실이 어느 세대 것인지 귀속을 못 한다.

이 도면(실측)에서 확인한 근거
  · 실명 텍스트는 레이어 `AA-MKXS` 에 308개 = 11실 × 28세대
  · 세대 안쪽에 타입 표기 `84A/84B/84C` 가 `...$0$DEFPOINT!!!!` 레이어에 21개
  · 평면 아래에 `84A TYPE` 형태 표기 33개 (`AA-MKXS`, `000_세대단열와리`)
  · 코어부 텍스트 84개 (`ELEV.`, `ELEV.홀`, `ELEV.전실`, `EPS/TPS`, `PD`,
    `AV`, `AV/PD`, `UP`, `DN`) — 전부 `AA-MKXS`

타입 표기는 평면 아래·옆 등 위치가 일정하지 않아 X 구간만으로는 세대를 못 가른다.
대신 **실명 텍스트가 세대별로 뭉쳐 있다**는 성질을 쓴다(한 세대 = 실명 약 11개).
텍스트를 근접도로 묶으면 세대가 그대로 떨어지고, 타입은 그 묶음에 가장 가까운
타입 표기에서 가져온다. 타입 표기가 없으면 사용자가 지정할 수 있게 남긴다.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

from ..config import loader as config

#: 세대 안쪽 타입 표기 (`84A`) 와 평면 밖 표기 (`84A TYPE`) 를 모두 잡는다
_TYPE_RE = re.compile(r"(\d{2,3}[A-Z])(?:\s*TYPE)?\s*$", re.I)


@dataclass
class LabelText:
    """도면에서 뽑은 텍스트 하나 — 시드 후보이자 세대 분리의 입력."""

    text: str
    x: float
    y: float
    layer: str
    category: str
    """rooms.yaml 의 카테고리 (LIVING/WET/ENTRY/SERVICE/EXCLUDE) 또는 빈 문자열."""


@dataclass
class UnitRegion:
    """세대 하나 — 실명 텍스트 묶음 + 바운딩 영역 + 타입."""

    index: int
    unit_type: Optional[str]
    """`84A` 등. 타입 표기를 못 찾으면 None — 사용자 지정 대상."""
    bbox_mm: tuple[float, float, float, float]
    """(minx, miny, maxx, maxy) — 실명 텍스트 범위에 여유를 더한 값."""
    seeds: list[LabelText] = field(default_factory=list)
    """이 세대의 시드(코어부 제외). EXCLUDE 는 여기 들어오지 않는다."""
    excluded: list[LabelText] = field(default_factory=list)
    """세대 영역 안에 들어온 코어부 텍스트 — 추적 대상이 아님을 기록만 한다."""

    @property
    def width_mm(self) -> float:
        return self.bbox_mm[2] - self.bbox_mm[0]

    @property
    def height_mm(self) -> float:
        return self.bbox_mm[3] - self.bbox_mm[1]


def classify(text: str) -> str:
    """
    실명 텍스트를 rooms.yaml 카테고리로 분류한다.

    EXCLUDE 를 **가장 먼저** 검사한다. `ELEV.전실` 은 '전실' 로도 EXCLUDE 지만
    LIVING 을 먼저 보면 '실' 계열로 오분류될 위험이 있다.
    매칭 실패 시 빈 문자열 — 시드로 쓰지 않는다(임의 번호 부여 금지).
    """
    cats = config.rooms().get("categories", {})
    up = text.upper()
    for name in ("EXCLUDE", "WET", "ENTRY", "SERVICE", "LIVING"):
        for word in cats.get(name, []):
            if str(word).upper() in up:
                return name
    return ""


def is_seed_candidate(text: str) -> bool:
    """치수 문자·타입명·기호 약어·부기를 시드에서 제외한다."""
    s = text.strip()
    if not s:
        return False
    for pat in config.rooms().get("seed_exclude_patterns", []):
        if re.match(str(pat), s):
            return False
    return True


def collect_labels(doc, scale: float, label_layers: Optional[Iterable[str]] = None
                   ) -> tuple[list[LabelText], list[tuple[str, float, float]]]:
    """
    TEXT/MTEXT 를 훑어 (실명 후보, 타입 표기) 를 함께 수집한다.

    Args:
        doc: ezdxf Drawing.
        scale: 도면 단위 → mm 배율.
        label_layers: 실명 레이어를 알면 지정한다. None 이면 전 레이어를 본다.

    Returns:
        (실명 후보 목록, [(타입, x, y), ...])
    """
    allow = set(label_layers) if label_layers else None
    labels: list[LabelText] = []
    types: list[tuple[str, float, float]] = []

    for e in doc.modelspace():
        if e.dxftype() not in ("TEXT", "MTEXT"):
            continue
        try:
            raw = (e.dxf.text if e.dxftype() == "TEXT" else e.text).strip()
        except Exception:
            continue
        if not raw:
            continue
        p = e.dxf.insert
        x, y = p.x * scale, p.y * scale

        m = _TYPE_RE.match(raw)
        if m:
            types.append((m.group(1).upper(), x, y))
            continue

        if allow is not None and e.dxf.layer not in allow:
            continue
        cat = classify(raw)
        if not cat:
            continue
        if cat != "EXCLUDE" and not is_seed_candidate(raw):
            continue
        labels.append(LabelText(raw, x, y, e.dxf.layer, cat))

    return labels, types


def _cluster(points: list[LabelText], radius_mm: float) -> list[list[LabelText]]:
    """
    근접 텍스트를 세대 단위로 묶는다 (단일 연결 클러스터링).

    격자 해싱으로 이웃만 보므로 O(n) 이다. 이중 루프를 쓰지 않는다.
    """
    if not points:
        return []
    cell = radius_mm
    grid: dict[tuple[int, int], list[int]] = {}
    for i, p in enumerate(points):
        grid.setdefault((int(p.x // cell), int(p.y // cell)), []).append(i)

    seen = [False] * len(points)
    out: list[list[LabelText]] = []
    r2 = radius_mm * radius_mm

    for i in range(len(points)):
        if seen[i]:
            continue
        stack = [i]
        seen[i] = True
        group: list[LabelText] = []
        while stack:
            k = stack.pop()
            pk = points[k]
            group.append(pk)
            gx, gy = int(pk.x // cell), int(pk.y // cell)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in grid.get((gx + dx, gy + dy), ()):
                        if seen[j]:
                            continue
                        pj = points[j]
                        if (pj.x - pk.x) ** 2 + (pj.y - pk.y) ** 2 <= r2:
                            seen[j] = True
                            stack.append(j)
        out.append(group)
    return out


#: 세대당 정확히 1개만 존재하는 실 — 세대 개수·기준점의 근거가 된다.
#: 이 도면 실측: 안방·현관·거실·주방/식당이 각각 정확히 28개 = 28세대.
_ANCHOR_PREFERENCE = ("안방", "현관", "거실", "주방/식당")


def _pick_anchors(seeds: list[LabelText]) -> tuple[str, list[LabelText]]:
    """
    세대 기준점으로 쓸 실명을 고른다.

    근접 묶음(단일 연결)은 세대가 맞붙어 있는 층 평면에서 신뢰할 수 없다.
    실측에서 반경 3.5m 로 묶으니 28세대가 43개로 쪼개졌다(시드 4/6/8/12개).
    세대당 1개인 실을 기준점으로 쓰면 세대 수가 그 개수로 확정된다.
    """
    counts: dict[str, list[LabelText]] = {}
    for s in seeds:
        counts.setdefault(s.text, []).append(s)
    for name in _ANCHOR_PREFERENCE:
        if name in counts:
            return name, counts[name]
    # 선호 목록에 없으면 가장 많이 나온 실명을 쓴다 (개수 = 세대 수 가정)
    if not counts:
        return "", []
    name = max(counts, key=lambda k: len(counts[k]))
    return name, counts[name]


def split(doc, scale: float, *,
          label_layers: Optional[Iterable[str]] = None,
          anchor_name: Optional[str] = None,
          margin_mm: float = 500.0) -> list[UnitRegion]:
    """
    세대 경계를 분리한다 — 세대당 1개인 실을 기준점으로 최근접 배정.

    Args:
        doc: ezdxf Drawing.
        scale: 도면 단위 → mm 배율.
        label_layers: 실명 레이어. None 이면 전 레이어.
        anchor_name: 기준점으로 쓸 실명. None 이면 자동 선택(안방→현관→거실 순).
        margin_mm: 실명 범위 밖으로 세대 바운딩을 넓히는 여유.

    Returns:
        세대 목록. 좌하단부터 정렬된다.
    """
    labels, types = collect_labels(doc, scale, label_layers)
    seeds = [l for l in labels if l.category != "EXCLUDE"]
    cores = [l for l in labels if l.category == "EXCLUDE"]

    if anchor_name:
        anchors = [s for s in seeds if s.text == anchor_name]
    else:
        anchor_name, anchors = _pick_anchors(seeds)
    if not anchors:
        return []

    # 실명별로 **세대 1개당 1실씩** 매칭한다.
    #
    # 단순 최근접 배정은 L자·회전 세대에서 옆 세대 실을 가져간다
    # (실측: 시드 수가 8/12/16 으로 갈렸다). 이 도면처럼 실명 개수가
    # 세대 수와 같으면(각 12실 × 28세대) 1:1 매칭이 성립하므로,
    # 가까운 쌍부터 greedy 로 확정해 한 세대가 같은 실명을 두 개 갖지 못하게 한다.
    groups: list[list[LabelText]] = [[a] for a in anchors]
    by_name: dict[str, list[LabelText]] = {}
    for s in seeds:
        if s is not None and s not in anchors:
            by_name.setdefault(s.text, []).append(s)

    for name, items in by_name.items():
        pairs = sorted(
            ((a.x - s.x) ** 2 + (a.y - s.y) ** 2, ai, si)
            for ai, a in enumerate(anchors)
            for si, s in enumerate(items)
        )
        used_anchor: set[int] = set()
        used_item: set[int] = set()
        for _, ai, si in pairs:
            if ai in used_anchor or si in used_item:
                continue
            groups[ai].append(items[si])
            used_anchor.add(ai)
            used_item.add(si)
            if len(used_item) == len(items):
                break
        # 세대 수보다 실명이 많으면(중복 표기 등) 남은 것은 최근접으로 붙인다
        for si, s in enumerate(items):
            if si in used_item:
                continue
            best, best_d = 0, float("inf")
            for ai, a in enumerate(anchors):
                d = (a.x - s.x) ** 2 + (a.y - s.y) ** 2
                if d < best_d:
                    best, best_d = ai, d
            groups[best].append(s)

    units: list[UnitRegion] = []
    for group in groups:
        xs = [p.x for p in group]
        ys = [p.y for p in group]
        bbox = (min(xs) - margin_mm, min(ys) - margin_mm,
                max(xs) + margin_mm, max(ys) + margin_mm)
        units.append(UnitRegion(index=len(units), unit_type=None,
                                bbox_mm=bbox, seeds=list(group)))

    # 타입 표기를 가장 가까운 세대에 붙인다. 표기가 세대 밖(평면 아래)에 있는
    # 경우가 많아 bbox 포함 여부가 아니라 최근접으로 판정한다.
    for t, tx, ty in types:
        best, best_d = None, float("inf")
        for u in units:
            cx = (u.bbox_mm[0] + u.bbox_mm[2]) / 2
            cy = (u.bbox_mm[1] + u.bbox_mm[3]) / 2
            d = math.hypot(cx - tx, cy - ty)
            if d < best_d:
                best, best_d = u, d
        if best is not None and best.unit_type is None:
            best.unit_type = t

    # 코어부 텍스트는 어느 세대 영역에 들어왔는지만 기록한다 — 시드로 쓰지 않는다.
    for c in cores:
        for u in units:
            x0, y0, x1, y1 = u.bbox_mm
            if x0 <= c.x <= x1 and y0 <= c.y <= y1:
                u.excluded.append(c)
                break

    units.sort(key=lambda u: (u.bbox_mm[1], u.bbox_mm[0]))
    for i, u in enumerate(units):
        u.index = i
    return units
