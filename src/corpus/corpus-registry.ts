/**
 * @Project: kr-history-bm25
 * @File: corpus-registry.ts
 * @Description: 코퍼스 자기설명 단일 소스. code→이름·성격 설명을 한 곳에서 정의하고, 마이그레이션 backfill·
 *               ingest 기록·읽기 폴백·MCP 도구 설명 조립이 모두 이 상수를 참조한다.
 *               🔴 손으로 유지되는 문자열이 사실상의 스키마가 되어 드리프트한 결함(krh-i2o)의 근본 해결.
 *               설명은 corpus-taxonomy 다축 분류(편찬 형식·관찰 위치)를 문장으로 담되 확정 해석은 담지 않는다.
 * @Author: shyang
 * @LastModified: 2026-08-21
 */

/** 코퍼스 1종의 자기설명 */
export interface CorpusMeta {
  /** 사서명 · 예: 삼국사기 */
  name: string;
  /** 이 코퍼스가 무엇인가 — 소비자(LLM)가 출처 성격을 추측하지 않게 하는 선언 */
  description: string;
}

/** 도구 설명 조립에 필요한 최소 형태 */
export interface CorpusCodeName {
  code: string;
  name: string;
}

/** 직역 보유 현황 조립에 필요한 최소 형태 */
export interface CorpusTranslationCount {
  name: string;
  passageCount: number;
  translatedCount: number;
}

/**
 * 동봉 코퍼스 5종. 🔴 키 순서 = 노출 순서(사서 연대순).
 * 실재 코드는 sg·sy·kr·kj·ko 다(과거 주석의 ss·ka는 실재하지 않는다).
 */
export const CORPUS_REGISTRY: Record<string, CorpusMeta> = {
  sg: {
    name: '삼국사기',
    description:
      '1145년(고려 인종 23) 김부식 등이 편찬한 기전체(紀傳體) 정사. 신라·고구려·백제의 본기·지·표·열전을 싣는다. ' +
      '한국 사서가 스스로를 기록한 내부 자기기록이며, 수록 본문은 한자 원문이다.',
  },
  sy: {
    name: '삼국유사',
    description:
      '고려 후기 일연이 편찬한 사서. 정사 체제 밖의 야사(野史)적 기록으로 건국 설화·불교 전승·향가 등 ' +
      '삼국사기가 싣지 않은 자료를 보존한다. 내부 기록이며, 수록 본문은 한자 원문이다.',
  },
  kr: {
    name: '고려사',
    description:
      '1451년(조선 문종 1) 완성된 기전체(紀傳體) 정사. 고려 왕조의 세가·지·표·열전을 싣는다. ' +
      '내부 자기기록이며, 수록 본문은 한자 원문이다.',
  },
  kj: {
    name: '고려사절요',
    description:
      '1452년(조선 문종 2) 완성된 편년체(編年體) 정사. 고려사와 내용이 상당 부분 겹치나 사건을 시간 순으로 ' +
      '서술해 포함·생략·배치의 차이를 대조할 수 있다. 고려사의 파생본이 아니다. 내부 자기기록이며, 수록 본문은 한자 원문이다.',
  },
  ko: {
    name: '한국고대사료집성',
    description:
      '중국 정사 25사 등에 실린 동이(東夷) 관련 기록을 발췌·집성한 자료. 『三國志』魏書 東夷傳·' +
      '『後漢書』東夷列傳 등의 한자 원문을 그대로 수록한다. 현대의 연구 성과나 해설이 아니라 1차 사료 발췌이며, ' +
      '한국 사서의 내부 자기기록과 대조하는 외부 관찰기록이다.',
  },
};

/** 레지스트리에 등재된 코드 목록(노출 순서) */
export function corpusCodes(): string[] {
  return Object.keys(CORPUS_REGISTRY);
}

/**
 * 코드의 등재 순번을 반환한다(정렬 키). 미등재는 뒤로 보낸다.
 * @param code - 코퍼스 코드
 * @returns 0부터 시작하는 순번, 미등재는 큰 수
 */
export function corpusOrder(code: string): number {
  const idx = corpusCodes().indexOf(code);
  return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
}

/**
 * 레지스트리 설명을 조회한다(DB 설명이 비었을 때의 폴백).
 * @param code - 코퍼스 코드
 * @returns 설명, 미등재면 null(거짓 설명을 지어내지 않는다)
 */
export function registryDescription(code: string): string | null {
  return CORPUS_REGISTRY[code]?.description ?? null;
}

/** 레지스트리를 code·name 목록으로 펼친다(DB 조회 실패 시 폴백) */
export function registryCodeNames(): CorpusCodeName[] {
  return Object.entries(CORPUS_REGISTRY).map(([code, meta]) => ({ code, name: meta.name }));
}

/**
 * corpusCode 파라미터 설명을 조립한다. 🔴 손유지 문자열 대신 실측 목록에서 생성한다.
 * @param corpora - 코드·이름 목록
 * @returns 도구 파라미터 describe 문자열
 */
export function describeCorpusCodes(corpora: readonly CorpusCodeName[]): string {
  const list = corpora.length > 0 ? corpora : registryCodeNames();
  return `코퍼스 코드로 제한(${list.map((c) => `${c.code}=${c.name}`).join('·')})`;
}

/**
 * 직역(보조 인덱스) 보유 현황을 문장으로 조립한다. 직역 0건 코퍼스는 유효 범위로 광고하지 않는다.
 * @param corpora - 건수를 아는 코퍼스 목록
 * @returns '삼국사기 5,733/6,086 · …' 형태, 보유 코퍼스가 없으면 빈 문자열
 */
export function describeTranslatedCorpora(corpora: readonly CorpusTranslationCount[]): string {
  return corpora
    .filter((c) => c.translatedCount > 0)
    .map(
      (c) => `${c.name} ${c.translatedCount.toLocaleString()}/${c.passageCount.toLocaleString()}`,
    )
    .join(' · ');
}
