# -*- coding: utf-8 -*-
"""
공차(tolerance) · 임계값 상수 집약 모듈.

지오메트리 함수는 tolerance 를 **인자로 받고** 기본값만 여기서 가져간다.
값을 코드 여기저기 흩어두지 않는다 — 실무 도면마다 조정이 필요하기 때문이다.

좌표 단위는 **내부적으로 mm(정수 기반)** 로 통일한다.
"""
from typing import Final

# ── 단위 ───────────────────────────────────────────────────
#: 내부 표준 단위. 모든 좌표는 로드 시 mm 로 환산한다.
INTERNAL_UNIT: Final[str] = "mm"

#: $INSUNITS 코드 → mm 환산 계수
INSUNITS_TO_MM: Final[dict[int, float]] = {
    0: 1.0,      # 미지정 — 추정 로직으로 결정
    1: 25.4,     # 인치
    2: 304.8,    # 피트
    4: 1.0,      # mm
    5: 10.0,     # cm
    6: 1000.0,   # m
    8: 0.0000254,  # 마이크로인치
}

#: $INSUNITS 가 0(미지정)일 때 바운딩박스 크기로 단위를 추정하는 범위.
#: 실측: 주동 전체 평면 1장이 496,000 × 354,000 mm 였다. 상한을 넉넉히 둔다.
UNIT_GUESS_MM_RANGE: Final[tuple[float, float]] = (100.0, 1_000_000.0)
UNIT_GUESS_M_RANGE: Final[tuple[float, float]] = (0.1, 1_000.0)

# ── 지오메트리 정리 ────────────────────────────────────────
#: 끝점 스냅 허용오차 (mm). UI 에서 0.1~50 조정.
SNAP_TOLERANCE_MM: Final[float] = 2.0

#: 중복 선분 판정 허용오차 (mm)
DUPLICATE_TOLERANCE_MM: Final[float] = 1.0

#: 미세 갭 봉합 최대 길이 (mm). 이보다 크면 개구부로 보고 자동 봉합하지 않는다.
MICRO_GAP_MAX_MM: Final[float] = 50.0

#: 곡선(ARC/CIRCLE/ELLIPSE/SPLINE) 이산화 시 최대 현 길이 (mm)
CURVE_CHORD_MAX_MM: Final[float] = 10.0

# ── 개구부 ─────────────────────────────────────────────────
#: 문 개구부로 인정하는 폭 범위 (mm)
DOOR_WIDTH_RANGE_MM: Final[tuple[float, float]] = (600.0, 1500.0)

#: 문 스윙 ARC 반지름으로 문 폭을 추정할 때의 유효 범위 (mm).
#: 실측 샘플: 690~991mm (중앙값 840) — 문 블록(INSERT)이 없고 ARC 로만 작도된 도면이 있다.
DOOR_SWING_RADIUS_RANGE_MM: Final[tuple[float, float]] = (600.0, 1300.0)

# ── 실(室) 판정 sanity check ───────────────────────────────
ROOM_AREA_MIN_M2: Final[float] = 0.5
ROOM_AREA_MAX_M2: Final[float] = 200.0
ROOM_MIN_VERTICES: Final[int] = 4
#: 둘레²/면적 비가 이 값을 넘으면 '가늘고 긴 비정상 형상' 경고.
#: 정사각형=16, 1:10 직사각형≈48.
ROOM_SHAPE_RATIO_MAX: Final[float] = 80.0

# ── 벽체 레이어 자동 판별 ──────────────────────────────────
#: 벽선으로 인정하는 선분 길이 하한 (mm).
#: 실측: 단열재 해칭 레이어는 중앙 길이 14~47mm, 실제 벽선은 350~522mm 였다.
#: 개수만으로 판별하면 해칭·문선을 벽체로 오인한다.
WALL_LINE_MEDIAN_MIN_MM: Final[float] = 150.0

#: 실명 레이어로 인정하는 최소 사전 매칭 건수.
#: 실측: AA-MKXS 레이어가 308건 매칭됐고, 나머지 텍스트 레이어는 0건이었다.
ROOM_LABEL_MIN_HITS: Final[int] = 5

#: 레이어명에서 제거할 XREF 바인드 접두어 패턴 (예: "XREF_주동 평면도$0$AA-WAXM-CONC")
XREF_LAYER_PREFIX_SEP: Final[str] = "$"

# ── 래스터 폴백 ────────────────────────────────────────────
RASTER_WINDOW_MM: Final[float] = 50_000.0   # 50m × 50m
RASTER_RESOLUTION_MM: Final[float] = 5.0    # 5mm/px
RASTER_LINE_THICKNESS_PX: Final[int] = 2

# ── 성능 ───────────────────────────────────────────────────
#: 이 개수를 넘으면 진행률 보고 + 백그라운드 처리 대상.
#: 실측 샘플이 180,068 엔티티였다 — 대용량이 예외가 아니라 기본이다.
LARGE_DRAWING_ENTITY_COUNT: Final[int] = 100_000
