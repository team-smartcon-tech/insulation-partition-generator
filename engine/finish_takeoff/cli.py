# -*- coding: utf-8 -*-
"""
CLI — 1단계: DXF 로드 + 레이어 분석 리포트.

사용:
    python -m finish_takeoff.cli analyze <도면.dxf> [--json out.json] [--unit mm]

이 단계의 목적은 **산출을 시작하기 전에 도면을 파악하는 것**이다.
여기서 나온 벽체/개구부/실명 레이어를 확정해야 이후 추적이 의미를 갖는다.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import asdict
from typing import Optional

from .dxf import layers as layer_mod
from .dxf.loader import DxfLoadError, load
from .models import LayerRole


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)-7s %(message)s",
        stream=sys.stderr,
    )


def cmd_analyze(path: str, unit: Optional[str], json_out: Optional[str]) -> int:
    """도면을 열어 레이어 분석 리포트를 출력한다."""
    try:
        doc, info = load(path, unit_override=unit)
    except DxfLoadError as e:
        print(f"오류: {e}", file=sys.stderr)
        return 1

    stats = layer_mod.analyze(doc, info.unit_scale_to_mm)
    preset = layer_mod.suggest_preset(stats)
    walls = layer_mod.wall_candidates(stats, top=5)

    w = info.bbox_mm[2] - info.bbox_mm[0]
    h = info.bbox_mm[3] - info.bbox_mm[1]

    print("=" * 76)
    print(f"도면 분석 리포트 — {path}")
    print("=" * 76)

    print("\n[1] 기본 정보")
    print(f"  단위          : $INSUNITS={info.insunits} → ×{info.unit_scale_to_mm:g} "
          f"({info.unit_source})")
    if info.unit_source == "bbox_guess":
        print("                  ⚠ 헤더 미지정 — 크기로 추정했다. 사용자 확인 필요")
    print(f"  크기          : {w:,.0f} × {h:,.0f} mm  ({w/1000:,.1f} × {h/1000:,.1f} m)")
    print(f"  엔티티        : {info.entity_count:,}개"
          + ("   ⚠ 대용량 — 백그라운드 처리 대상" if info.is_large else ""))
    print(f"  레이어        : {info.layer_count}개 (엔티티 보유 {len(stats)}개)")
    print(f"  INSERT 중첩   : 최대 {info.max_insert_depth}단계")
    print(f"  미러 INSERT   : {info.mirrored_insert_count}개"
          + ("   ← 변환행렬 테스트 필수" if info.mirrored_insert_count else ""))
    print(f"  미해결 XREF   : {'있음 ⚠' if info.has_unresolved_xref else '없음'}")

    print("\n[2] 벽체 후보 (선분 길이 중앙값 기준 — 개수만으로 판단하지 않는다)")
    if not walls:
        print("  ⚠ 후보 없음 — 벽선 길이가 임계값에 못 미친다. 레이어를 직접 지정해야 한다.")
    for i, (s, score, why) in enumerate(walls, 1):
        mark = "★" if i <= 3 else " "
        print(f"  {mark} {i}. {s.normalized:<24} 선 {s.line_count:>6,}개  score={score:>10,.0f}")
        print(f"       근거: {why}")

    print("\n[3] 자동 감지 프리셋 초안")
    for role in LayerRole:
        names = preset.roles.get(role, [])
        if names:
            print(f"  {role.value:<12}: {', '.join(names[:6])}"
                  + (f" 외 {len(names)-6}개" if len(names) > 6 else ""))
    unmatched = layer_mod.unmatched_layers(stats, preset)
    print(f"  (미매칭 레이어 {len(unmatched)}개 — UI 에서 사용자 지정 필요)")

    print("\n[4] 상위 레이어 (엔티티 수)")
    print(f"  {'레이어(정규화)':<26} {'총계':>8} {'선':>7} {'중앙길이':>9}  구성")
    print("  " + "-" * 72)
    for s in stats[:15]:
        detail = ", ".join(f"{k}:{v}" for k, v in
                           sorted(s.entity_counts.items(), key=lambda kv: -kv[1])[:3])
        print(f"  {s.normalized[:25]:<26} {s.total:>8,} {s.line_count:>7,} "
              f"{s.median_line_length_mm:>8.0f}mm  {detail}")

    if json_out:
        payload = {
            "drawing": asdict(info),
            "layers": [asdict(s) for s in stats],
            "preset": {"name": preset.name,
                       "roles": {r.value: v for r, v in preset.roles.items()}},
        }
        with open(json_out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"\n  → JSON 저장: {json_out}")

    print("\n다음 단계: 위 벽체/개구부/실명 레이어를 확정한 뒤 2단계(선분화)로 진행한다.")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="finish_takeoff", description="마감 물량 산출 엔진")
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("analyze", help="DXF 레이어 분석 리포트")
    a.add_argument("path")
    a.add_argument("--unit", choices=["mm", "cm", "m", "in", "ft"],
                   help="단위 강제 지정 ($INSUNITS 무시)")
    a.add_argument("--json", dest="json_out", help="분석 결과 JSON 저장 경로")
    a.add_argument("-v", "--verbose", action="store_true")

    ns = ap.parse_args(argv)
    _setup_logging(getattr(ns, "verbose", False))
    if ns.cmd == "analyze":
        return cmd_analyze(ns.path, ns.unit, ns.json_out)
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
