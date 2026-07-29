# finish_takeoff — 마감 물량 산출 + 기성 관리 엔진

DXF 도면에서 실(室) 영역을 추적해 마감 물량을 산출하고, 완료 범위를 입력하면
기성 물량을 뽑는 **UI 비의존 Python 패키지**다. 오토콘(웹)은 이 엔진의 API만 호출한다.

> **이 엔진의 숫자는 견적·기성 청구에 직접 쓰인다.**
> 목표는 "동작하는 것"이 아니라 **"틀렸을 때 반드시 알려주는 것"** 이다.
> 폐합 실패를 근사값으로 덮지 않는다.

## 설치

```bash
pip install -r requirements.txt      # ezdxf shapely numpy Pillow openpyxl
```

## 1단계 — 도면 분석 (현재 구현 범위)

```bash
python -m finish_takeoff.cli analyze <도면.dxf> [--unit mm] [--json out.json]
```

산출을 시작하기 전에 **벽체·개구부·실명 레이어를 확정**하기 위한 리포트다.

## 구조

```
finish_takeoff/
  constants.py     공차·임계값 집약 (하드코딩 금지 — 값은 전부 여기)
  models.py        공용 데이터 모델
  dxf/loader.py    로드 · 단위 정규화
  dxf/layers.py    레이어 분석 · 역할 자동 판별 · 프리셋
  cli.py           CLI
tests/             단위 테스트
```

## 실측 도면에서 얻은 설계 근거

샘플: `251118_세대단열와리_검토2★.dxf` (주동 평면도, 180,068 엔티티 / 228 레이어)

| 발견 | 대응 |
|---|---|
| 도면 크기 496m × 354m | 단위 추정 상한을 1,000,000mm 로. `$INSUNITS` 헤더를 1순위로 신뢰 |
| 문 레이어 24,116선 · 단열재 해칭 20,357선 > 실제 벽체 3,576선 | **개수가 아니라 선분 길이 중앙값**으로 벽체 판별 (벽선 350~522mm vs 해칭 14~47mm) |
| 문이 INSERT 블록이 아니라 LINE+ARC 로 작도 | 문 블록 인식에 의존하지 않고 **ARC 반지름(690~991mm)=문 폭** 경로 필요 |
| 레이어명이 `XREF_주동 평면도$0$AA-WAXM-CONC` | 프리셋 매칭 전 **XREF 접두어 정규화** |
| 수량 텍스트 레이어(1,2,3…)가 실명으로 오인됨 | **실명 사전 매칭 건수**로 판별 (AA-MKXS 308건 vs 나머지 0건) |
| 엔티티 18만 개, 로드 16초 | 대용량이 예외가 아니라 기본 — 백그라운드 처리 전제 |

## 진행 상황

**1부 · 엔진 (도면 → 물량)**
- [x] 1. DXF 로더 + 레이어 분석 리포트 (CLI)
- [x] 2. 엔티티 → 선분화 (INSERT 재귀 전개 · 미러 처리)
- [x] 3. 지오메트리 정리 (스냅/중복제거/교차분할)
- [x] 4. 벡터 폐합영역 추적 + sanity check
- [x] 5. 개구부 처리 (문 스윙 ARC → 폐합선)
- [x] 6. 래스터 폴백 (+ 트인 공간 중복 계상 차단)
- [x] 7. 물량 산출 규칙 + Excel 출력
- [ ] 8. UI 연동 (오토콘 리본에 붙이기)

**2부 · 기성**
- [x] 9. 세대 대장 (Excel 붙여넣기 · 규칙 생성기 · 필로티/결번 제외)
- [x] 10. 범위 문자열 파서 + 미리보기
- [x] 11. 진도 모델(누계) + 차수 관리 + 스냅샷
- [ ] 12. 그리드 UI (엔진 범위 밖 — UI 연동 시)
- [x] 13. 기성 산출 + 검증 규칙
- [x] 14. 기성 Excel 출력 (5시트)
- [x] 15. 이력/스냅샷 + REV 변경 대응

## 사용 예 (전 구간)

```python
# 도면 → 실 물량
doc, info = load("평면도.dxf")
stats = layers.analyze(doc, info.unit_scale_to_mm)
preset = layers.suggest_preset(stats)
segs, _ = entities.extract_segments(doc, info.unit_scale_to_mm, layers=wall_layers)
result = raster_fill.trace(segs, click_mm)          # 또는 polygonize.trace_at()
rooms  = [rules.compute(room_name="거실", polygon=result.polygon)]
excel.write("물량산출서.xlsx", rooms)

# 세대 대장 → 기성
reg = UnitRegistry.from_rule(["101"], 1, 25, {"01": "84A", "02": "84B"},
                             exclude_floors=[1])     # 필로티 제외
matched = parser.parse("101동 2~15F 전체 @50%", reg)  # 미리보기 후 적용
store.set_many(Progress(1, u.key, "WALLPAPER", r) for u, r in matched.matched)
res = compute_billing(period=p2, registry=reg, store=store,
                      quantities=q, prev_period=p1)
report = validate(period=p2, result=res, ...)        # 오류면 확정 차단
if report.can_lock:
    lock_period(p2, q)                               # 물량 스냅샷 고정
billing_excel.write("기성청구서.xlsx", res, validation=report)
```
