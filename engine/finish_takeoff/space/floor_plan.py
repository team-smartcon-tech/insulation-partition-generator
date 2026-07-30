# -*- coding: utf-8 -*-
"""
층 평면 단위 분할 — 세대를 따로 돌리지 않고 **한 번에** 분할한다.

왜 세대별로 돌리면 안 되는가 (실측 근거)
    세대 bbox 는 실명 범위로 만든 사각형이라 실제 세대 경계가 아니다.
      · bbox 를 그대로 쓰면 세대분리벽이 격자 밖에 있어 영역이 박스 밖으로 새고,
        현관이 20.5㎡ 로 공용홀을 먹었다.
      · bbox 를 2m 넓히면 벽은 들어오지만 이웃 세대·복도가 **경쟁 시드 없이**
        열려서 더 나빠졌다 (현관 47.8㎡, 발코니-1 47.2㎡).
    다중 시드 분할은 "빈 공간에 경쟁자가 없으면 계속 퍼진다"가 본질이다.
    따라서 **이웃 세대 시드와 코어부 시드를 같이 넣어** 경쟁시키면
    경계가 세대분리벽·코어벽에 자연히 떨어진다.

코어부(ELEV/EPS/TPS/PD/AV/UP/DN/전실/홀)는 **경쟁 시드로는 넣고 결과에서는 뺀다.**
시드로 안 넣으면 현관이 홀을 먹고, 결과에 넣으면 코어부가 물량에 섞인다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

from .partition import PartitionResult, RegionResult, partition
from .unit_split import LabelText, UnitRegion

Point = tuple[float, float]


@dataclass
class FloorPlan:
    """한 장의 층 평면 — 세대 여러 개 + 그 사이 코어부."""

    index: int
    bbox_mm: tuple[float, float, float, float]
    units: list[UnitRegion] = field(default_factory=list)
    cores: list[LabelText] = field(default_factory=list)
    """이 평면 안의 코어부 텍스트 — 경쟁 시드로만 쓴다."""

    @property
    def width_mm(self) -> float:
        return self.bbox_mm[2] - self.bbox_mm[0]

    @property
    def height_mm(self) -> float:
        return self.bbox_mm[3] - self.bbox_mm[1]


def group_plans(units: Sequence[UnitRegion], cores: Sequence[LabelText], *,
                gap_mm: float = 15000.0,
                margin_mm: float = 3000.0) -> list[FloorPlan]:
    """
    세대들을 같은 층 평면끼리 묶는다.

    한 DXF 에 여러 동(401~404동, 405동 …)의 평면이 떨어져 배치돼 있다.
    Y 방향으로 `gap_mm` 이상 떨어지면 다른 평면으로 본다.

    Args:
        units: S1 결과 세대 목록.
        cores: 코어부 텍스트 전체.
        gap_mm: 이 이상 벌어지면 다른 평면.
        margin_mm: 평면 bbox 여유 — 외벽이 격자 안에 들어오게 한다.

    Returns:
        평면 목록 (아래에서 위로).
    """
    if not units:
        return []

    ordered = sorted(units, key=lambda u: u.bbox_mm[1])
    groups: list[list[UnitRegion]] = [[ordered[0]]]
    for u in ordered[1:]:
        prev_top = max(x.bbox_mm[3] for x in groups[-1])
        if u.bbox_mm[1] - prev_top > gap_mm:
            groups.append([u])
        else:
            groups[-1].append(u)

    plans: list[FloorPlan] = []
    for gi, group in enumerate(groups):
        x0 = min(u.bbox_mm[0] for u in group) - margin_mm
        y0 = min(u.bbox_mm[1] for u in group) - margin_mm
        x1 = max(u.bbox_mm[2] for u in group) + margin_mm
        y1 = max(u.bbox_mm[3] for u in group) + margin_mm
        inside = [c for c in cores if x0 <= c.x <= x1 and y0 <= c.y <= y1]
        plans.append(FloorPlan(index=gi, bbox_mm=(x0, y0, x1, y1),
                               units=list(group), cores=inside))
    return plans


def partition_plan(plan: FloorPlan, mask, *,
                   entry_closures: Sequence = (),
                   wall_edges: Sequence = (),
                   res_mm: Optional[float] = None
                   ) -> tuple[PartitionResult, dict[int, list[RegionResult]]]:
    """
    평면 전체를 한 번에 분할하고 결과를 세대별로 되돌린다.

    Args:
        plan: 대상 평면.
        mask: 이 평면 범위의 벽체 솔리드 마스크.
        entry_closures: 현관문 폐합 장벽 (세대 밖으로 나가는 통로만).
        wall_edges: 벽면 선분 — 정점 스냅으로 안목치수를 맞춘다.
        res_mm: 래스터 해상도.

    Returns:
        (전체 분할 결과, {세대 index: [해당 세대 영역들]})
        코어부 영역은 어느 세대에도 배정하지 않는다.
    """
    seeds: list[tuple[str, str, Point]] = []
    owner: list[Optional[int]] = []      # 시드별 소속 세대 index (코어부는 None)

    for u in plan.units:
        for s in u.seeds:
            seeds.append((s.text, s.category, (s.x, s.y)))
            owner.append(u.index)
    for c in plan.cores:
        seeds.append((c.text, "EXCLUDE", (c.x, c.y)))
        owner.append(None)

    result = partition(mask, seeds, plan.bbox_mm,
                       res_mm=res_mm, pad_mm=0.0,
                       extra_barriers=entry_closures,
                       wall_edges=wall_edges)

    by_unit: dict[int, list[RegionResult]] = {u.index: [] for u in plan.units}
    for r in result.regions:
        who = owner[r.seed_index] if r.seed_index < len(owner) else None
        if who is None:
            continue                      # 코어부 — 결과에서 제외
        by_unit[who].append(r)
    return result, by_unit
