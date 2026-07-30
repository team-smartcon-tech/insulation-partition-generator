# -*- coding: utf-8 -*-
"""
범위 문자열 파서 — 한 줄로 수십 세대를 지정한다.

지원 문법
    101동 1~15F 전체
    101동 16F 01,02호
    101,102동 1~5F 전체
    101~103동 전층 01라인
    101동 1~15F 전체 -12F          # 층 제외
    103동 전층 A타입
    101동 1~10F 전체 @50%          # 진도율 (생략 시 100%)

원칙
  · 파싱 결과는 **미리보기 후 적용**한다. 즉시 반영하지 않는다.
  · 실패 시 **몇 번째 줄 어느 토큰이 문제인지** 알려준다.
  · 대장에 없는 세대는 **경고 + 스킵** (조용히 무시하지 않는다).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from ..registry.units import UnitInstance, UnitRegistry


@dataclass
class ParseError:
    """파싱 실패 1건."""

    line_no: int
    token: str
    message: str

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.line_no}번째 줄 '{self.token}': {self.message}"


@dataclass
class RangeSpec:
    """한 줄이 지정하는 범위."""

    line_no: int
    raw: str
    buildings: list[str]
    floors: Optional[list[int]]   # None = 전층
    exclude_floors: list[int] = field(default_factory=list)
    unit_filter: Optional[str] = None   # "01,02호" | "01라인" | "84A타입" | None(전체)
    filter_kind: str = "all"            # "all" | "unit_no" | "line" | "type"
    ratio: float = 1.0                  # 진도율 0.0~1.0


@dataclass
class ParseResult:
    """파싱 결과 — 미리보기에 그대로 쓴다."""

    specs: list[RangeSpec] = field(default_factory=list)
    errors: list[ParseError] = field(default_factory=list)
    matched: list[tuple[UnitInstance, float]] = field(default_factory=list)
    """(세대, 진도율) — 실제 매칭된 세대."""
    missing: list[str] = field(default_factory=list)
    """대장에 없어 스킵한 지정."""

    @property
    def ok(self) -> bool:
        return not self.errors

    @property
    def count(self) -> int:
        return len(self.matched)

    def summary(self) -> str:
        s = f"{len(self.specs)}개 지정 · {self.count}세대 매칭"
        if self.missing:
            s += f" · 스킵 {len(self.missing)}건"
        if self.errors:
            s += f" · 오류 {len(self.errors)}건"
        return s


_RE_BUILDING = re.compile(r"^([\d,~\-]+)동$")
_RE_FLOOR_RANGE = re.compile(r"^(\d+)\s*~\s*(\d+)\s*F?$", re.I)
_RE_FLOOR_ONE = re.compile(r"^(\d+)\s*F$", re.I)
_RE_EXCLUDE = re.compile(r"^-\s*(\d+)\s*F?$", re.I)
_RE_RATIO = re.compile(r"^@\s*(\d+(?:\.\d+)?)\s*%$")
_RE_UNIT_NOS = re.compile(r"^([\d,]+)\s*호$")
_RE_LINE = re.compile(r"^([\dA-Za-z,]+)\s*라인$")
_RE_TYPE = re.compile(r"^([0-9A-Za-z가-힣]+)\s*타입$")


def _expand_numbers(text: str) -> list[str]:
    """'101,102' / '101~103' → ['101','102','103']"""
    out: list[str] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "~" in part or "-" in part:
            sep = "~" if "~" in part else "-"
            a, b = part.split(sep, 1)
            if a.strip().isdigit() and b.strip().isdigit():
                out.extend(str(n) for n in range(int(a), int(b) + 1))
                continue
        out.append(part)
    return out


def parse_line(text: str, line_no: int = 1) -> tuple[Optional[RangeSpec], list[ParseError]]:
    """한 줄을 RangeSpec 으로 파싱한다."""
    errs: list[ParseError] = []
    raw = text.strip()
    if not raw or raw.startswith("#"):
        return None, errs

    tokens = raw.split()
    spec = RangeSpec(line_no=line_no, raw=raw, buildings=[], floors=None)
    got_building = False

    for tok in tokens:
        if m := _RE_BUILDING.match(tok):
            spec.buildings = _expand_numbers(m.group(1))
            got_building = True
        elif tok in ("전층", "전체층"):
            spec.floors = None
        elif m := _RE_EXCLUDE.match(tok):
            spec.exclude_floors.append(int(m.group(1)))
        elif m := _RE_FLOOR_RANGE.match(tok):
            a, b = int(m.group(1)), int(m.group(2))
            if a > b:
                errs.append(ParseError(line_no, tok, f"층 범위가 거꾸로입니다 ({a}~{b})"))
            else:
                spec.floors = list(range(a, b + 1))
        elif m := _RE_FLOOR_ONE.match(tok):
            spec.floors = [int(m.group(1))]
        elif m := _RE_RATIO.match(tok):
            v = float(m.group(1))
            if not (0 <= v <= 100):
                errs.append(ParseError(line_no, tok, "진도율은 0~100% 사이여야 합니다"))
            else:
                spec.ratio = v / 100.0
        elif tok in ("전체", "전세대"):
            spec.filter_kind, spec.unit_filter = "all", None
        elif m := _RE_UNIT_NOS.match(tok):
            spec.filter_kind, spec.unit_filter = "unit_no", m.group(1)
        elif m := _RE_LINE.match(tok):
            spec.filter_kind, spec.unit_filter = "line", m.group(1)
        elif m := _RE_TYPE.match(tok):
            spec.filter_kind, spec.unit_filter = "type", m.group(1)
        else:
            errs.append(ParseError(line_no, tok, "해석할 수 없는 토큰입니다"))

    if not got_building:
        errs.append(ParseError(line_no, raw[:20], "동 지정이 없습니다 (예: '101동')"))
    return (spec if not errs else None), errs


def match_units(spec: RangeSpec, registry: UnitRegistry) -> tuple[list[UnitInstance], list[str]]:
    """RangeSpec 에 해당하는 세대를 대장에서 찾는다."""
    matched: list[UnitInstance] = []
    bset = set(spec.buildings)
    found_buildings: set[str] = set()

    for u in registry:
        if u.building not in bset:
            continue
        found_buildings.add(u.building)
        if spec.floors is not None and u.floor not in spec.floors:
            continue
        if u.floor in spec.exclude_floors:
            continue
        if spec.filter_kind == "unit_no":
            nos = {n.strip() for n in (spec.unit_filter or "").split(",")}
            # "01호" 는 라인 표기로도 쓰이므로 뒷자리 일치도 허용
            if u.unit_no not in nos and u.line not in nos:
                continue
        elif spec.filter_kind == "line":
            lines = {n.strip() for n in (spec.unit_filter or "").split(",")}
            if u.line not in lines:
                continue
        elif spec.filter_kind == "type":
            if u.unit_type != (spec.unit_filter or ""):
                continue
        matched.append(u)

    missing = [f"{b}동 (대장에 없음)" for b in bset - found_buildings]
    return matched, missing


def parse(text: str, registry: UnitRegistry) -> ParseResult:
    """
    여러 줄을 파싱하고 대장과 매칭한다.

    **결과를 즉시 적용하지 말고 미리보기로 보여준 뒤 확인받아야 한다.**
    """
    res = ParseResult()
    seen: dict[str, float] = {}

    for i, line in enumerate(text.splitlines(), 1):
        spec, errs = parse_line(line, i)
        res.errors.extend(errs)
        if spec is None:
            continue
        res.specs.append(spec)
        units, missing = match_units(spec, registry)
        res.missing.extend(missing)
        if not units and not missing:
            res.missing.append(f"{i}번째 줄: 매칭 세대 0건 — '{spec.raw}'")
        for u in units:
            seen[u.key] = spec.ratio  # 뒤에 온 지정이 앞을 덮어쓴다

    key_map = {u.key: u for u in registry}
    res.matched = [(key_map[k], r) for k, r in seen.items() if k in key_map]
    return res
