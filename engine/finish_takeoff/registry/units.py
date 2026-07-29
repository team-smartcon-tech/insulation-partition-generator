# -*- coding: utf-8 -*-
"""
세대 대장 — 기성 산출의 기본 단위.

집계형 매트릭스(타입 → 총 세대수)로는 "101동 15층 1502호가 도배 완료" 를 지목할
수 없어 기성 산출이 불가능하다. **개별 세대를 원소로 갖는 대장**을 기본 구조로 삼고,
집계 매트릭스는 대장에서 파생한다.

입력 3종
  1. Excel 붙여넣기 (실무 최다) — 동/층/호/타입 4열 탭·쉼표 구분
  2. 규칙 생성기 — 동 + 층범위 + 라인별 타입 → 전 세대 자동 생성
  3. 개별 수동 추가/수정

**필로티층·기계실층·결번 호수 제외**를 규칙 생성 단계에서 지정할 수 있어야 한다.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Iterator, Optional


@dataclass(frozen=True)
class UnitInstance:
    """세대 1개."""

    building: str   # 동   "101"
    floor: int      # 층   15
    unit_no: str    # 호   "1502"
    line: str       # 라인 "02"
    unit_type: str  # 타입 "84A"

    @property
    def key(self) -> str:
        """대장 내 고유 키."""
        return f"{self.building}-{self.unit_no}"

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.building}동 {self.floor}F {self.unit_no}호({self.unit_type})"


@dataclass
class UnitRegistry:
    """세대 대장."""

    units: list[UnitInstance] = field(default_factory=list)

    # ── 조회 ────────────────────────────────────────────
    def __len__(self) -> int:
        return len(self.units)

    def __iter__(self) -> Iterator[UnitInstance]:
        return iter(self.units)

    def by_key(self, key: str) -> Optional[UnitInstance]:
        return next((u for u in self.units if u.key == key), None)

    @property
    def buildings(self) -> list[str]:
        return sorted({u.building for u in self.units})

    @property
    def types(self) -> list[str]:
        return sorted({u.unit_type for u in self.units})

    def type_counts(self) -> dict[str, int]:
        """집계 매트릭스 — 대장에서 파생한다(별도 입력 대상이 아니다)."""
        return dict(Counter(u.unit_type for u in self.units))

    def floors_of(self, building: str) -> list[int]:
        return sorted({u.floor for u in self.units if u.building == building})

    def add(self, u: UnitInstance) -> bool:
        """중복 키면 추가하지 않고 False."""
        if self.by_key(u.key):
            return False
        self.units.append(u)
        return True

    def remove(self, key: str) -> bool:
        n = len(self.units)
        self.units = [u for u in self.units if u.key != key]
        return len(self.units) != n

    # ── 입력 1: Excel 붙여넣기 ──────────────────────────
    @classmethod
    def from_paste(cls, text: str) -> tuple["UnitRegistry", list[str]]:
        """
        Excel 에서 복사한 텍스트를 파싱한다 (동/층/호/타입 4열).

        탭·쉼표 구분 모두 허용. 헤더 행은 자동으로 건너뛴다.

        Returns:
            (대장, 오류 메시지 목록) — 오류 행은 **조용히 버리지 않고 보고**한다.
        """
        reg = cls()
        errors: list[str] = []
        for i, raw in enumerate(text.splitlines(), 1):
            line = raw.strip()
            if not line:
                continue
            cols = [c.strip() for c in re.split(r"[\t,]", line) if c.strip() != ""]
            if len(cols) < 4:
                errors.append(f"{i}행: 열이 4개 미만입니다 — '{line[:40]}'")
                continue
            if not cols[1].replace("F", "").replace("층", "").strip().lstrip("-").isdigit():
                if i == 1:
                    continue  # 헤더로 보고 건너뜀
                errors.append(f"{i}행: 층이 숫자가 아닙니다 — '{cols[1]}'")
                continue
            bld, floor_s, unit_no, utype = cols[0], cols[1], cols[2], cols[3]
            floor = int(re.sub(r"[^\d-]", "", floor_s))
            unit_no = re.sub(r"[^0-9A-Za-z]", "", unit_no)
            line_no = unit_no[-2:] if len(unit_no) >= 2 else unit_no
            u = UnitInstance(bld.replace("동", "").strip(), floor, unit_no, line_no, utype)
            if not reg.add(u):
                errors.append(f"{i}행: 중복 세대 — {u.key}")
        return reg, errors

    # ── 입력 2: 규칙 생성기 ─────────────────────────────
    @classmethod
    def from_rule(
        cls,
        buildings: Iterable[str],
        floor_from: int,
        floor_to: int,
        line_types: dict[str, str],
        *,
        exclude_floors: Iterable[int] = (),
        exclude_units: Iterable[str] = (),
        unit_no_fmt: str = "{floor}{line}",
    ) -> "UnitRegistry":
        """
        규칙으로 전 세대를 생성한다.

        예) 101동 / 1~25F / {"01": "84A", "02": "84B"} → 50세대

        Args:
            buildings: 동 목록.
            floor_from, floor_to: 층 범위 (양끝 포함).
            line_types: 라인 → 타입.
            exclude_floors: 제외할 층 (필로티·기계실 등).
            exclude_units: 제외할 호수 (결번). "101-1502" 또는 "1502" 형식.
            unit_no_fmt: 호수 생성 규칙.

        Returns:
            UnitRegistry
        """
        reg = cls()
        ex_f = set(exclude_floors)
        ex_u = {str(x) for x in exclude_units}
        for b in buildings:
            for f in range(floor_from, floor_to + 1):
                if f in ex_f:
                    continue
                for line, utype in line_types.items():
                    no = unit_no_fmt.format(floor=f, line=line)
                    if no in ex_u or f"{b}-{no}" in ex_u:
                        continue
                    reg.add(UnitInstance(str(b), f, no, line, utype))
        return reg

    def merge(self, other: "UnitRegistry") -> int:
        """다른 대장을 합친다. 반환값은 실제로 추가된 세대 수."""
        return sum(1 for u in other.units if self.add(u))

    def group_by_building(self) -> dict[str, list[UnitInstance]]:
        out: dict[str, list[UnitInstance]] = defaultdict(list)
        for u in self.units:
            out[u.building].append(u)
        return dict(out)
