/**
 * 품질관리계획서(PQP) 서식 목록과 부서별 작성 현황.
 *
 * 왜 있나: 현장 서류는 회사 품질관리계획서가 정한 서식(QA-4.2-1 ~ QA-10.2-2)을 채우는 일이
 * 많다. 계획서는 절마다 **주관 부서**를 정해 두었으므로(첨부 QA-6.3-2 "항목별 담당파트 현황"),
 * "우리 부서가 써야 할 서류를 다 썼나"를 신호등으로 보여 준다(2026-10-13 사용자 결정).
 *
 * 서식 이름·주관·협조는 부산 장안 품질관리계획서(P0453C-PQP-01 개정 2)의 각 절 "첨부" 목록과
 * QA-6.3-2 를 그대로 옮겼다. 환경은 계획서 범위 밖이라(담당파트 표에 없다) 여기 없다.
 *
 * **어느 서류가 어느 서식인지는 시트 이름으로 안다.** 회사 양식 엑셀은 시트 이름이 서식 번호다
 * (`QA-7.2-2`, 지난달 장은 `QA-4.2-2(25.09)`). 그래서 배포 양식에 번호를 따로 붙이지 않아도
 * 배포 양식에서 만든 현장 서류가 저절로 맞물린다.
 */

import { PERIODIC, alertDaysOf, cycleOf, isExternal, parseDay, periodKeyOf, periodsBetween, sheetDate, type QmpCycle, type QmpSiteSettings } from "./qmpCycle.ts";

export type QmpDept = "품질" | "공무" | "공사";
export const QMP_DEPTS: QmpDept[] = ["품질", "공무", "공사"];

export interface QmpForm {
  /** 서식 번호에서 "QA-" 를 뺀 것(예: "7.2-2") */
  code: string;
  name: string;
  /**
   * 절차·기준 문서인가(PROCESS 흐름도, 작성방법, 평가기준). 현장이 채우지 않고 따르기만 하므로
   * 신호등을 달지 않는다 — 달면 영영 꺼진 불이 "안 한 일"처럼 보인다.
   */
  reference: boolean;
}

export interface QmpSection {
  /** 절 번호(예: "7.2") */
  no: string;
  title: string;
  /** 주관 부서 */
  lead: QmpDept;
  /** 협조 부서 */
  help: QmpDept[];
  forms: QmpForm[];
}

export const QMP_CHAPTERS: Record<string, string> = {
  "4": "조직의 상황",
  "5": "리더십",
  "6": "기획",
  "7": "지원",
  "8": "운용",
  "9": "성과관리",
  "10": "개선",
};

type Raw = [code: string, name: string, kind?: "ref"];

function section(no: string, title: string, lead: QmpDept, help: QmpDept[], forms: Raw[]): QmpSection {
  return {
    no,
    title,
    lead,
    help,
    forms: forms.map(([code, name, kind]) => ({ code, name, reference: kind === "ref" || /PROCESS/.test(name) })),
  };
}

/*
 * 8.3 설계관리·8.9 고객재산관리는 표에 주관이 있지만 부산 장안은 "적용 제외"(계획서 2.2)다.
 * 현장마다 다르므로 목록에는 넣고, 현장별 적용 제외는 나중에 정한다.
 */
export const QMP_SECTIONS: QmpSection[] = [
  section("4.2", "이해관계자의 요구와 기대관리", "공무", [], [
    ["4.2-1", "이해관계자의 요구와 기대관리 PROCESS"],
    ["4.2-2", "이해관계자의 요구사항 및 관리방안"],
  ]),
  section("4.3", "프로세스 관리", "품질", ["공무", "공사"], [
    ["4.3-1", "프로세스 관리 PROCESS"],
    ["4.3-2", "건설공사 프로세스 간의 상호작용 관계도"],
    ["4.3-3", "표준 프로세스 등록대장"],
    ["4.3-4", "프로세스 관리번호 작성방법", "ref"],
    ["4.3-5", "표준 프로세스 Map"],
  ]),
  section("5.1", "품질방침", "품질", [], [
    ["5.1-1", "품질방침 PROCESS"],
    ["5.1-2", "현장 품질방침 및 목표"],
  ]),
  section("5.2", "책임 및 권한", "품질", ["공무", "공사"], [
    ["5.2-1", "현장 조직도"],
    ["5.2-2", "개인별 업무 분장표"],
  ]),
  section("6.1", "리스크 및 기회관리", "공무", ["공사"], [
    ["6.1-1", "리스크 및 기회관리 PROCESS"],
    ["6.1-2", "리스크 평가기준", "ref"],
    ["6.1-3", "리스크 및 기회 평가표"],
    ["6.1-4", "리스크 및 기회 대응계획서"],
  ]),
  section("6.2", "품질목표관리", "품질", [], [
    ["6.2-1", "품질목표 수립 PROCESS"],
    ["6.2-2", "품질목표 및 달성계획"],
    ["6.2-3", "품질목표 운영 현황"],
  ]),
  section("6.3", "품질관리계획서의 변경관리", "품질", ["공사"], [
    ["6.3-1", "품질관리계획서 변경관리 PROCESS"],
    ["6.3-2", "품질관리계획서 항목별 담당파트 현황"],
  ]),
  section("7.1", "자원관리", "공무", [], [
    ["7.1-1", "자원관리 PROCESS"],
    ["7.1-2", "현장 기반시설 및 업무환경 구축 요구사항"],
    ["7.1-3", "기반구조관리상태 점검표"],
  ]),
  section("7.2", "모니터링 자원 및 측정자원의 관리", "품질", ["공무"], [
    ["7.2-1", "모니터링 자원 및 측정자원의 관리 PROCESS"],
    ["7.2-2", "검교정 측정장비 관리대장"],
    ["7.2-3", "측정기기 관리카드"],
  ]),
  section("7.3", "조직의 지식관리", "품질", ["공무", "공사"], [
    ["7.3-1", "지식관리 PROCESS"],
    ["7.3-2", "현장 지식관리대장"],
  ]),
  section("7.4", "역량 및 적격성 관리", "품질", ["공무", "공사"], [
    ["7.4-1", "역량 및 적격성 관리 PROCESS"],
    ["7.4-2", "교육훈련 운영 기준표"],
    ["7.4-3", "연간 교육훈련 계획표"],
    ["7.4-4", "역량/적격성 평가서"],
    ["7.4-5", "교육결과 보고서"],
    ["7.4-6", "참석자 명단"],
  ]),
  section("7.5", "의사소통 관리", "공무", ["공사"], [
    ["7.5-1", "주요 의사소통 관리기준"],
    ["7.5-2", "공문 접수 대장"],
    ["7.5-3", "공문 발송 대장"],
    ["7.5-4", "회의록"],
  ]),
  section("7.6", "문서화된 정보 및 정보의 관리", "공무", ["품질"], [
    ["7.6-1", "문서화된 정보 및 정보의 관리 PROCESS"],
    ["7.6-2", "설계도서 관리대장"],
    ["7.6-3", "문서관리 대장"],
    ["7.6-4", "문서 접수/발송 관리 대장"],
    ["7.6-5", "문서 및 기록 목록표"],
  ]),
  section("8.1", "건설공사 요구사항 검토 및 준비", "공사", [], [
    ["8.1-1", "인허가 업무계획"],
    ["8.1-2", "사업승인(인허가)조건 이행현황"],
    ["8.1-3", "실시도서 도면 검토 체크리스트"],
  ]),
  section("8.2", "건설공사 요구사항 변경", "공무", ["공사"], [
    ["8.2-1", "건설공사 요구사항 변경 PROCESS"],
    ["8.2-2", "현장 설계변경 요청서"],
    ["8.2-3", "설계변경 관리대장"],
  ]),
  section("8.3", "설계관리", "공무", [], [
    ["8.3-1", "설계관리 PROCESS"],
    ["8.3-2", "설계입력 기준서"],
    ["8.3-3", "설계 검토·검증 정보"],
    ["8.3-4", "설계 검토·검증 정보"],
    ["8.3-5", "설계 실현성 확인 정보"],
  ]),
  section("8.4", "기자재 구매관리", "공무", ["품질", "공사"], [
    ["8.4-1", "기자재 구매관리 PROCESS"],
    ["8.4-2", "주요기자재 수급계획서"],
    ["8.4-3", "공장점검 계획서"],
    ["8.4-4", "주요기자재 공급원 검토 요청서"],
    ["8.4-5", "기자재 청구서"],
    ["8.4-6", "주요자재 검사 및 수불부"],
  ]),
  section("8.5", "외부에서 제공되는 프로세스 관리", "공무", ["공사"], [
    ["8.5-1", "외부에서 제공되는 프로세스 관리 PROCESS"],
    ["8.5-2", "하도업체 발주계획"],
  ]),
  section("8.6", "공사관리", "공사", [], [
    ["8.6-1", "공사 예정공정표"],
    ["8.6-2", "3개월 공정표"],
    ["8.6-3", "주간 공정표"],
    ["8.6-4", "시공상세도 작성계획"],
    ["8.6-5", "시공상세도 검토요청서"],
    ["8.6-6", "시공상세도 배포대장"],
    ["8.6-7", "주변 민원관리 대장"],
    ["8.6-8", "주변 민원일지"],
  ]),
  section("8.7", "중점품질관리", "품질", ["공사"], [
    ["8.7-1", "중점 품질관리 PROCESS"],
    ["8.7-2", "특수공정/중점관리 수행인원 적격성 평가표"],
    ["8.7-3", "중점관리 요원 자격관리 대장"],
  ]),
  section("8.8", "식별 및 추적관리", "공무", ["품질", "공사"], [
    ["8.8-1", "식별 및 추적관리 PROCESS"],
    ["8.8-2", "기자재식별표지"],
  ]),
  section("8.9", "고객 또는 외부공급자의 재산관리", "공무", ["공사"], [
    ["8.9-1", "고객 또는 외부공급자의 재산관리 PROCESS"],
    ["8.9-2", "고객재산 목록표"],
  ]),
  section("8.10", "보존관리", "공무", ["공사"], [
    ["8.10-1", "보존관리 PROCESS"],
    ["8.10-2", "기자재 유형별 관리방법"],
    ["8.10-3", "주요 기자재 품목별 보관방법"],
    ["8.10-4", "기자재 보관상태 점검"],
  ]),
  section("8.11", "검사 및 시험, 모니터링", "품질", ["공사"], [
    ["8.11-1", "검사 및 시험, 모니터링관리 PROCESS"],
    ["8.11-2", "검사 및 시험계획(ITP)"],
    ["8.11-3", "공장점검 보고서"],
    ["8.11-4", "자재 입고검사 Checklist"],
    ["8.11-5", "자재검수 요청서"],
    ["8.11-6", "품질검사 실시대장"],
    ["8.11-7", "품질검사 실적보고서"],
    ["8.11-8", "품질검사 성과 총괄표"],
    ["8.11-9", "검측 요청서"],
    ["8.11-10", "검측 체크리스트"],
  ]),
  section("8.12", "부적합 공사의 관리", "품질", ["공무", "공사"], [
    ["8.12-1", "부적합 공사의 관리 PROCESS"],
    ["8.12-2", "현지시정 통보서"],
    ["8.12-3", "부적합보고서"],
    ["8.12-4", "부적합보고서 관리대장"],
    ["8.12-5", "실패비용 산출서"],
  ]),
  section("8.13", "공사준공 및 인계", "공무", ["품질", "공사"], [
    ["8.13-1", "장비 및 시설물 인수인계서"],
    ["8.13-2", "이관자료 목록"],
  ]),
  section("9.1", "고객만족", "공무", ["공사"], [
    ["9.1-1", "고객만족 PROCESS"],
    ["9.1-2", "프로젝트 만족도 설문 조사서"],
  ]),
  section("9.2", "분석 및 평가", "품질", ["공무", "공사"], [["9.2-1", "데이터 수집 및 분석보고서"]]),
  section("9.3", "내부심사", "품질", ["공사"], [
    ["9.3-1", "자체 내부심사 PROCESS"],
    ["9.3-2", "내부심사 계획서"],
    ["9.3-3", "자체 내부심사 점검표"],
    ["9.3-4", "자체 내부심사 결과 보고서"],
  ]),
  section("9.4", "경영검토", "품질", ["공무", "공사"], [
    ["9.4-1", "품질경영검토 PROCESS"],
    ["9.4-2", "품질경영검토 보고서"],
  ]),
  section("10.1", "부적합 및 시정조치", "품질", ["공무", "공사"], [
    ["10.1-1", "부적합 및 시정조치 PROCESS"],
    ["10.1-2", "부적합 시정조치 요구서"],
    ["10.1-3", "부적합 시정조치 요구서 관리대장"],
    ["10.1-4", "부적합 시정조치 보고서"],
  ]),
  section("10.2", "지속적 개선", "품질", ["공사"], [
    ["10.2-1", "지속적 개선 PROCESS"],
    ["10.2-2", "지속적 개선항목 관리대장"],
  ]),
];

export const chapterOf = (sectionNo: string) => sectionNo.split(".")[0];

/**
 * 시트 이름에서 서식 번호를 읽는다. 없으면 null.
 *
 * `QA-7.2-2`, `QA-4.2-2(25.09)`, `QA-7.5-4(양식)`, 회사 원본의 오타 `QA-7.3.-1` 까지 받는다.
 * 앞뒤 공백·대소문자·하이픈 대신 쓴 밑줄도 너그럽게 본다.
 */
export function qaCodeOf(sheetName: string): string | null {
  const match = sheetName.trim().match(/^QA[\s_-]*(\d+)\.(\d+)\.?[\s_-]+(\d+)/i);
  return match ? `${Number(match[1])}.${Number(match[2])}-${Number(match[3])}` : null;
}

/** 서식 번호를 찾을 때 쓰는 서류 정보 — 시트 이름과, 시트에 번호가 없을 때 볼 서류 이름 */
export interface QmpNamed {
  sheetNames: string[];
  title?: string;
  fileName?: string;
  /**
   * [시트 추가]로 더한 장 → 바탕으로 쓴 원본 시트. 더한 장은 이름이 "2026-07" 처럼 서식 번호가 없어서,
   * 원본 시트의 번호로 같은 서식의 다음 장임을 안다(월별 서식의 달마다 장).
   */
  sheetSources?: Record<string, string>;
  /** 파일째 보관하는 첨부(PDF 등) — 시트가 없다 */
  attachment?: boolean;
}

/**
 * 서류의 시트 이름 → 서식 번호.
 *
 * 보통은 시트 이름에 번호가 있다(`QA-7.2-2`). **어느 시트에도 번호가 없으면** 서류 이름의 절 번호로
 * 찾는다 — 9.4 경영검토 양식은 시트가 "경영검토 프로세스", "표지", "1.현장방침"… 이라 올려도 아무
 * 서식에도 잡히지 않았다(사용자 신고). 그때는
 * - 이름에 "프로세스"·"PROCESS" 가 든 시트 → 그 절의 PROCESS 서식
 * - 나머지 시트 → 그 절에 현장이 쓰는 서식이 **하나뿐**일 때만 그 서식(여럿이면 어느 것인지 몰라 두지 않는다)
 */
export function sheetCodesOf(doc: QmpNamed): Map<string, string> {
  const codes = new Map<string, string>();
  for (const name of doc.sheetNames) {
    const code = qaCodeOf(name);
    if (code) codes.set(name, code);
  }
  /**
   * 번호 없는 원본 시트(견본)는 **바로 앞 서식 시트**의 견본이다 — 회사 양식은 `QA-10.1-2, 견본,
   * QA-10.1-3, 견본 (2)` 처럼 서식 바로 뒤에 견본을 둔다. [시트 추가]는 견본을 바탕으로 고르는 게
   * 기본이라, 이걸 모르면 더한 장이 어느 서식 것인지 몰라 "수시 · 0건"에서 늘지 않았다(사용자 신고).
   */
  const codeOfSource = (source: string): string | undefined => {
    const own = codes.get(source) ?? qaCodeOf(source) ?? undefined;
    if (own) return own;
    const at = doc.sheetNames.indexOf(source);
    for (let i = at - 1; i >= 0; i -= 1) {
      const before = codes.get(doc.sheetNames[i]);
      if (before) return before;
    }
    return undefined;
  };
  // 더한 장은 원본 시트의 번호를 잇는다.
  for (const name of doc.sheetNames) {
    const source = doc.sheetSources?.[name];
    const code = !codes.has(name) && source ? codeOfSource(source) : undefined;
    if (code) codes.set(name, code);
  }
  if (codes.size > 0) return codes;

  /*
   * [결과 올리기]로 올린 외부 작성 결과(PDF 등)는 시트가 없다. 이름을 "QA-8.6-3 주간 공정표 (2026-10-12 주)"처럼
   * 서식 번호로 시작하게 지어 두므로, 이름의 번호로 그 서식에 붙인다(이름 자체를 장 하나로 친다).
   */
  if (doc.attachment && doc.sheetNames.length === 0 && doc.title) {
    const code = qaCodeOf(doc.title);
    if (code) return new Map([[doc.title, code]]);
  }

  const label = `${doc.title ?? ""} ${doc.fileName ?? ""}`;
  const match = /(?:^|[^\d.])(\d{1,2})\.(\d{1,2})(?![\d.-])/.exec(label);
  const sec = match ? QMP_SECTIONS.find((item) => item.no === `${Number(match[1])}.${Number(match[2])}`) : undefined;
  if (!sec) return codes;
  const process = sec.forms.find((form) => /PROCESS/i.test(form.name));
  const writable = sec.forms.filter((form) => !form.reference);
  for (const name of doc.sheetNames) {
    if (/프로세스|process/i.test(name)) {
      if (process) codes.set(name, process.code);
    } else if (writable.length === 1) {
      codes.set(name, writable[0].code);
    }
  }
  return codes;
}

/**
 * 바로 앞 서식에 딸린 시트 이름 — 견본(채워 둔 예시)과 참고 자료.
 * 7.6 엑셀의 "문서보안기준안(참고)"는 QA-7.6-5 목록표의 보안등급을 정할 때 보는 표라 7.6-5 와 함께 보인다
 * (2026-10-16 사용자 결정).
 */
const ATTACHED_NAME = /견본|샘플|sample|참고/i;

/**
 * 그 서식 번호에 딸린 시트 — 서식 시트, 그 바로 뒤의 견본·참고 시트, [시트 추가]로 더한 장.
 *
 * 회사 양식 엑셀은 절마다 한 권이라(10.2 에 QA-10.2-1·10.2-2·견본…) 서식 하나를 열어도 모든 시트가
 * 탭에 떠서 같은 파일이 열린 것처럼 보였다(2026-10-16 사용자 신고). 계획서 화면에서 서식을 열면 이것만
 * 탭에 보인다. 그 서식이 없으면 빈 배열(그때는 전부 보인다).
 * 어느 서식에도 딸리지 않은 시트(빈 Sheet1·Sheet8, 7.2 의 "카메라")는 서식 화면에서 보이지 않는다
 * — 사용자가 "지워 버려"라고 정했다.
 */
export function sheetsOfCode(doc: QmpNamed, code: string): string[] {
  const codes = sheetCodesOf(doc);
  const result: string[] = [];
  let lastCode: string | undefined;
  for (const name of doc.sheetNames) {
    const own = codes.get(name);
    const added = doc.sheetSources?.[name] !== undefined;
    if (own) {
      if (!added) lastCode = own;
      if (own === code) result.push(name);
    } else if (!added && ATTACHED_NAME.test(name) && lastCode === code) {
      result.push(name);
    }
  }
  return result;
}

/** 서식 한 장의 상태 */
export type QmpStatus = "done" | "doing" | "none";

/** 현황 계산에 필요한 서류 정보(목록 요약에서 이만큼만 쓴다) */
export interface QmpDoc extends QmpNamed {
  id: string;
  /** 무언가 적었거나 결재가 걸린 시트(작성 중인 장) */
  workingSheets?: string[];
  approvalSheets?: {
    sheetName: string;
    slots: { signKey: string }[];
    approvals: Record<string, { approvedAt?: number }>;
    changed?: boolean;
  }[];
  /** 시트 이름 → 그 장을 쓰는 부서 */
  sheetDepts?: Record<string, string>;
  /** 서류를 만든 때 — 이름에 달이 없는 장은 이때 쓴 것으로 본다 */
  uploadedAt?: number;
  /** [시트 추가]로 더한 장 → 더한 때 */
  sheetMadeAt?: Record<string, number>;
  /** 시트 이름 → 마지막으로 글자를 고친 때(없으면 서류를 마지막으로 저장한 때로 본다) */
  sheetEditedAt?: Record<string, number>;
  /** 서류를 마지막으로 저장한 때 */
  updatedAt?: number;
}

export interface QmpFormState {
  status: QmpStatus;
  /** 열어 볼 서류와 시트(같은 서식이 여러 장이면 가장 진척된 것) */
  docId?: string;
  sheetName?: string;
  /** 다 끝난 때(결재 마지막 시각). 결재칸이 없는 장은 없다. */
  finishedAt?: number;
  /** 그 장을 쓰는 부서([작성하기] 때 정한다). 정하기 전에 만든 서류는 없다. */
  dept?: QmpDept;
  /** 이 현장에서 정한 작성 주기 */
  cycle?: QmpCycle;
  /** 주기 서식: 착공일부터 오늘까지의 기간마다 상태(마지막이 지금 기간) */
  periods?: { key: string; label: string; status: QmpStatus; docId?: string; sheetName?: string }[];
  /** 주기 서식: 쓴 기간 수 / 써야 할 기간 수(지금 기간 포함) */
  written?: number;
  due?: number;
  /** 수시 서식: 쓴 장 수 */
  count?: number;
  /** 수시 서식: 마지막으로 기록한 때 */
  lastAt?: number;
  /** 수시 서식: 마지막 기록 뒤 알림 날수를 넘겼으면 지난 날수 — 불 색·%와는 상관없는 알림이다 */
  quietDays?: number;
  /** 이 현장 계획서가 적용 제외한 절의 서식 — 세지 않는다 */
  excluded?: boolean;
  /** 준공 때 쓰는 서식인데 아직 안 썼다 — 때가 아니므로 세지 않는다 */
  notYet?: boolean;
  /** 다른 사내 시스템에서 작성하는 서식 — 그 화면 링크와 [결과 올리기]를 단다. 올린 결과로 센다. */
  external?: boolean;
  /**
   * 진행률에 세지 않는다 — 주기(주간·월간…) 외부 작성 서식. 매주 다른 시스템에 쓰고 PDF 를 또 올리면 두 번
   * 일이라(2026-10-17 사용자 결정) 링크와 [결과 올리기](필요할 때만)만 둔다. 한 번 쓰는 외부 서식은 센다.
   */
  uncounted?: boolean;
}

const RANK: Record<QmpStatus, number> = { none: 0, doing: 1, done: 2 };

/**
 * 현장 서류들로 서식마다 상태를 매긴다.
 *
 * - **초록(done)**: 그 서식 시트의 결재가 다 끝났다. 결재칸이 없는 서식은 무언가 적었으면 끝으로 본다.
 * - **노랑(doing)**: 적기 시작했거나 결재가 진행 중이다. 결재 뒤 내용을 고친 것도 여기다.
 * - **빈 불(none)**: 그 서식 시트를 적은 적이 없다. 배포 양식을 복사만 해 둔 것도 아직 빈 불이다.
 *
 * 같은 서식이 여러 장이면(월별) **한 장이라도 끝났으면 초록**이다 — 계획서는 "작성·보관"을 묻지,
 * 모든 달을 다 결재했는지까지 이 화면이 따질 일은 아니다.
 */
export function qmpStates(
  docs: QmpDoc[],
  /** 현장 작성 일정과 오늘 — 주면 주기별 진척·적용 제외까지 매긴다 */
  options?: { settings?: QmpSiteSettings; today?: Date },
): Map<string, QmpFormState> {
  const result = new Map<string, QmpFormState>();
  /** 서식마다 쓴 장들(주기 진척을 셀 때 쓴다) */
  const instances = new Map<string, { state: QmpFormState; at: number; editedAt: number }[]>();
  const offer = (code: string, next: QmpFormState) => {
    const current = result.get(code);
    if (
      !current ||
      RANK[next.status] > RANK[current.status] ||
      (next.status === current.status && (next.finishedAt ?? 0) > (current.finishedAt ?? 0)) ||
      // 같은 진척이면 부서를 정해 둔 장을 — [작성하기]로 부서만 정하고 아직 안 쓴 장도 그 부서가 보이게.
      (next.status === current.status && (next.finishedAt ?? 0) === (current.finishedAt ?? 0) && !current.dept && next.dept)
    ) {
      result.set(code, next);
    }
  };

  for (const doc of docs) {
    const working = new Set(doc.workingSheets ?? []);
    const approvalBySheet = new Map((doc.approvalSheets ?? []).map((sheet) => [sheet.sheetName, sheet]));
    for (const [sheetName, code] of sheetCodesOf(doc)) {
      const approval = approvalBySheet.get(sheetName);
      let state: QmpFormState;
      if (approval) {
        const times = approval.slots.map((slot) => approval.approvals[slot.signKey]?.approvedAt);
        const complete = approval.slots.length > 0 && times.every((at) => at !== undefined) && !approval.changed;
        state = complete
          ? { status: "done", finishedAt: Math.max(...times.map((at) => at ?? 0)) }
          : { status: "doing" };
      } else {
        // 올린 외부 작성 결과(시트 없는 첨부)는 올린 것으로 끝이다.
        const uploaded = doc.attachment === true && doc.sheetNames.length === 0;
        state = { status: working.has(sheetName) || uploaded ? "done" : "none" };
      }
      const dept = doc.sheetDepts?.[sheetName];
      const full: QmpFormState = {
        ...state,
        docId: doc.id,
        sheetName,
        ...(QMP_DEPTS.includes(dept as QmpDept) ? { dept: dept as QmpDept } : {}),
      };
      offer(code, full);
      if (state.status !== "none") {
        const at = sheetDate(sheetName)?.getTime() ?? doc.sheetMadeAt?.[sheetName] ?? doc.uploadedAt ?? 0;
        const editedAt = doc.sheetEditedAt?.[sheetName] ?? doc.updatedAt ?? at;
        instances.set(code, [...(instances.get(code) ?? []), { state: full, at, editedAt }]);
      }
    }
  }
  if (options) applyCycles(result, instances, options.settings, options.today ?? new Date());
  return result;
}

/**
 * 현장 설정으로 서식마다 주기 진척을 더한다.
 * - 주기 서식: 착공일부터 기간마다 쓴 장이 있나. 지난 기간이 다 찼으면 초록, 하나라도 썼으면 노랑.
 *   지금 기간은 아직 안 써도 빠진 것으로 치지 않는다.
 * - 수시: 쓴 장 수만 센다(몇 번이 맞는지 정할 수 없다).
 * - 준공 때: 쓰기 전에는 세지 않는다.
 * - 적용 제외 절: 세지 않는다.
 */
function applyCycles(
  result: Map<string, QmpFormState>,
  instances: Map<string, { state: QmpFormState; at: number; editedAt: number }[]>,
  settings: QmpSiteSettings | undefined,
  today: Date,
) {
  const start = parseDay(settings?.startDate);
  const excluded = new Set(settings?.excluded ?? []);
  for (const sec of QMP_SECTIONS) {
    for (const form of sec.forms) {
      if (form.reference) continue;
      const base: QmpFormState = result.get(form.code) ?? { status: "none" };
      const cycle = cycleOf(form.code, settings);
      const list = instances.get(form.code) ?? [];
      let next: QmpFormState = { ...base, cycle, ...(isExternal(form.code, settings) ? { external: true } : {}) };
      if (excluded.has(sec.no)) next = { ...next, excluded: true };
      else if (cycle === "adhoc") {
        // 발송대장처럼 한 장에 줄을 쌓는 서식은 장이 늘지 않는다 — 건수 대신 마지막 기록 뒤 날수로 알린다.
        const lastAt = list.length > 0 ? Math.max(...list.map((item) => item.editedAt)) : undefined;
        const limit = alertDaysOf(form.code, settings);
        const days = lastAt ? Math.floor((today.getTime() - lastAt) / 86_400_000) : 0;
        next = {
          ...next,
          count: list.length,
          ...(lastAt ? { lastAt } : {}),
          ...(lastAt && limit > 0 && days >= limit ? { quietDays: days } : {}),
        };
      }
      else if (cycle === "completion" && base.status === "none") next = { ...next, notYet: true };
      else if (PERIODIC.includes(cycle) && start) {
        const periods = periodsBetween(cycle, start, today);
        const byKey = new Map<string, QmpFormState>();
        const firstKey = periods[0]?.key;
        for (const item of list) {
          let key = periodKeyOf(cycle, new Date(item.at));
          if (item.at < (periods[0]?.from ?? 0) && firstKey) key = firstKey;
          const current = byKey.get(key);
          if (!current || RANK[item.state.status] > RANK[current.status]) byKey.set(key, item.state);
        }
        const rows = periods.map((period) => {
          const hit = byKey.get(period.key);
          return {
            key: period.key,
            label: period.label,
            status: hit?.status ?? ("none" as QmpStatus),
            ...(hit?.docId ? { docId: hit.docId, sheetName: hit.sheetName } : {}),
          };
        });
        const written = rows.filter((row) => row.status === "done").length;
        const past = rows.slice(0, -1);
        const status: QmpStatus =
          rows.length > 0 && past.every((row) => row.status === "done") && written > 0
            ? "done"
            : rows.some((row) => row.status !== "none")
              ? "doing"
              : "none";
        next = { ...next, status, periods: rows, written, due: rows.length };
      }
      if (next.external && PERIODIC.includes(cycle)) next = { ...next, uncounted: true };
      result.set(form.code, next);
    }
  }
}

/** 배포 양식 가운데 그 서식 시트를 가진 것(가장 최근에 올라온 것). [작성하기]에 쓴다. */
export function templateForCode<T extends QmpNamed & { id: string; uploadedAt: number }>(
  templates: T[],
  code: string,
): T | undefined {
  return templates
    .filter((template) => [...sheetCodesOf(template).values()].includes(code))
    .sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
}

/** 그 절을 쓰는 부서들 — 주관이 맨 앞 */
export function writersOf(sec: QmpSection): QmpDept[] {
  return [sec.lead, ...sec.help.filter((dept) => dept !== sec.lead)];
}

/** 서식 번호가 든 절 */
export function sectionOfCode(code: string): QmpSection | undefined {
  return QMP_SECTIONS.find((sec) => sec.forms.some((form) => form.code === code));
}

/**
 * 그 부서가 쓰는 절인가 — 주관이든 협조든 작성에 참여한다(2026-10-13 사용자 결정: "공사·공무도
 * 작성해야 하는 것"). 부서 탭에 협조 절이 빠지면 그 부서가 써야 할 서류가 안 보인다.
 */
export function writesSection(sec: QmpSection, dept: QmpDept): boolean {
  return sec.lead === dept || sec.help.includes(dept);
}

/**
 * 부서 하나(또는 전체)의 신호등 집계.
 * 기준 문서는 현장이 쓰지 않으므로 빼고 센다. 배포 양식함은 기준 문서도 양식이라 함께 센다.
 *
 * 부서 탭은 **그 부서가 주관(●)인 절만** 센다(2026-10-16 사용자 결정). 협조(○) 부서는 주관 부서에 내용을
 * 주고 서류는 주관이 한 부로 쓴다 — 협조까지 세면 서류 하나가 세 부서 탭에 다 "작성됨"으로 잡혔다.
 * 협조 절은 탭에 "협조"로 보이기만 한다. 배포 양식함(`countHelp`)은 양식이 있나만 보므로 협조 절도 센다.
 */
export function qmpTally(
  states: Map<string, QmpFormState>,
  dept: QmpDept | null,
  chapter: string | null = null,
  includeReference = false,
  countHelp = false,
): { done: number; doing: number; none: number; total: number } {
  const tally = { done: 0, doing: 0, none: 0, total: 0 };
  for (const sec of QMP_SECTIONS) {
    if (dept && !(countHelp ? writesSection(sec, dept) : sec.lead === dept)) continue;
    if (chapter && chapterOf(sec.no) !== chapter) continue;
    const part = qmpSectionTally(states, sec, includeReference);
    tally.done += part.done;
    tally.doing += part.doing;
    tally.none += part.none;
    tally.total += part.total;
  }
  return tally;
}

/** 절 하나의 신호등 집계 — 홈의 "진척이 낮은 절"도 이것으로 센다. */
export function qmpSectionTally(
  states: Map<string, QmpFormState>,
  sec: QmpSection,
  includeReference = false,
): { done: number; doing: number; none: number; total: number } {
  const tally = { done: 0, doing: 0, none: 0, total: 0 };
  for (const form of sec.forms) {
    if (form.reference && !includeReference) continue;
    const state = states.get(form.code);
    // 적용 제외 절, 아직 때가 아닌 준공 서식은 세지 않는다.
    if (state?.excluded || state?.notYet || state?.uncounted) continue;
    tally[state?.status ?? "none"] += 1;
    tally.total += 1;
  }
  return tally;
}

/** 집계를 신호등 하나로: 다 끝났으면 초록, 하나라도 시작했으면 노랑, 아니면 빈 불. */
export function lampOf(tally: { done: number; doing: number; total: number }): QmpStatus {
  if (tally.total > 0 && tally.done === tally.total) return "done";
  return tally.done + tally.doing > 0 ? "doing" : "none";
}

/** 계획서 서식에 맞춘 시트가 하나라도 있나 — 없으면 계획서 서식이 아닌 서류("그 밖의 서류")다. */
export const hasQmpSheet = (doc: QmpNamed) => sheetCodesOf(doc).size > 0;

/**
 * 배포 양식함용: 서식마다 그 시트가 든 배포 양식(가장 최근 것). 양식이 있으면 `done` 이다.
 * 열면 그 서식 시트로 바로 간다.
 */
export function qmpLibraryStates<T extends QmpNamed & { id: string; uploadedAt: number }>(
  templates: T[],
): Map<string, QmpFormState> {
  const result = new Map<string, QmpFormState & { uploadedAt: number }>();
  for (const template of templates) {
    for (const [sheetName, code] of sheetCodesOf(template)) {
      const current = result.get(code);
      if (!current || template.uploadedAt > current.uploadedAt) {
        result.set(code, { status: "done", docId: template.id, sheetName, uploadedAt: template.uploadedAt });
      }
    }
  }
  return result;
}

/**
 * [전체 가져오기]로 만들 배포 양식들 — 이 현장에 아직 없는 서식이 든 양식만, 계획서 순서대로.
 *
 * - 현장이 쓸 서식(기준 문서 제외)이 하나라도 빠진 양식만 고른다. PROCESS 흐름도만 든 양식까지
 *   가져오면 현장 서류함이 쓸 일 없는 사본으로 찬다.
 * - 이미 그 양식으로 만든 서류가 있으면 건너뛴다(같은 사본이 둘 생기지 않게).
 * - 서식마다 가장 최근 양식을 쓴다(`qmpLibraryStates` 와 같은 기준).
 */
export function templatesToImport<T extends QmpNamed & { id: string; uploadedAt: number }>(
  templates: T[],
  siteDocs: (QmpNamed & { templateId?: string })[],
): string[] {
  const library = qmpLibraryStates(templates);
  const have = new Set<string>();
  for (const doc of siteDocs) for (const code of sheetCodesOf(doc).values()) have.add(code);
  const copied = new Set(siteDocs.map((doc) => doc.templateId).filter(Boolean));
  const picked: string[] = [];
  for (const sec of QMP_SECTIONS) {
    for (const form of sec.forms) {
      if (form.reference || have.has(form.code)) continue;
      const templateId = library.get(form.code)?.docId;
      if (!templateId || copied.has(templateId) || picked.includes(templateId)) continue;
      picked.push(templateId);
    }
  }
  return picked;
}
