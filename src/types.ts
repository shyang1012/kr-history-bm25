/**
 * @Project: kr-history-bm25
 * @File: types.ts
 * @Description: 공용 도메인 타입 — 파싱 결과·검색 결과 인터페이스.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */

/** 파싱된 계층 노드(level1~6) */
export interface ParsedNode {
  /** 원본 XML id */
  id: string;
  /** 상위 노드 id · 루트는 null */
  parentId: string | null;
  /** 레벨 번호(1~6) */
  levelNo: number;
  /** DTD type 속성 */
  type: string | null;
  /** DTD value 속성 */
  value: string | null;
  /** 왕명 속성 */
  wangmyeong: string | null;
  /** 재위년도 속성 */
  reignYear: string | null;
  /** 노드 제목(mainTitle) */
  title: string | null;
  /** materialized path */
  path: string;
  /** 형제 내 순번 */
  seq: number;
}

/** 파싱된 색인 출현(<index>) */
export interface ParsedMention {
  /** 개체 유형 · 지명/이름/국명 등 */
  type: string;
  /** 표기(한자) */
  surface: string;
  /** 본문 내 문자 오프셋 */
  charOffset: number;
  /** <index> 부가 속성 */
  attrs: Record<string, string> | null;
}

/** 파싱된 주석(교감주·원주 등) */
export interface ParsedAnnotation {
  /** 주석 유형 */
  type: string | null;
  /** 주석 텍스트 */
  text: string;
}

/** 파싱된 본문 단위(paragraph) */
export interface ParsedPassage {
  /** 소속 노드 id */
  nodeId: string;
  /** 노드 내 문단 순번 */
  seq: number;
  /** 한자 원문(표점 포함, 공백 제거) */
  textHan: string;
  /** 색인 출현 목록 */
  mentions: ParsedMention[];
  /** 주석 목록 */
  annotations: ParsedAnnotation[];
}

/** 한 XML 문서(사서 1권)의 파싱 결과 */
export interface ParsedDocument {
  /** 계층 노드 목록(개방 순서) */
  nodes: ParsedNode[];
  /** 본문 단위 목록 */
  passages: ParsedPassage[];
}

/** 검색 결과 1건(한자·직역 공통) */
export interface SearchHit {
  /** 본문 id */
  passageId: number;
  /** 소속 노드 id */
  nodeId: string;
  /** 코퍼스 코드 */
  corpusCode: string;
  /** 한자 원문 */
  textHan: string;
  /** BM25 점수(낮을수록 관련) */
  score: number;
}

/** 직역(보조) 검색 결과 1건 */
export interface KoSearchHit extends SearchHit {
  /** 채택된 직역 텍스트 */
  koText: string | null;
}

/** 이표기 확장 검색 결과 */
export interface VariantSearchResult {
  /** 확장된 표기 목록(자기 자신 포함) */
  surfaces: string[];
  /** 병합된 검색 결과 */
  hits: SearchHit[];
}

/** 퍼지 군집 멤버 1건(소속도 병기) */
export interface FuzzyMember {
  /** 표기(한자·정자, 불변) */
  surface: string;
  /** 개체 유형 */
  type: string;
  /** 이 군집에 대한 소속도(코어=1, 경계=분할) */
  membership: number;
  /** 간자체 병기(정자와 다를 때만·지도 대조용) */
  simplified?: string;
}

/** 퍼지 지명 군집 1건 */
export interface FuzzyPlaceCluster {
  /** 군집 id(정렬 canonical) */
  clusterId: number;
  /** 소속 멤버(소속도 내림차순·표기 오름차순) */
  members: FuzzyMember[];
}

/** 파라미터 선정 근거(auto 모드) */
export interface PlaceClusterSelection {
  /** 'fixed'(기본값·명시값) | 'auto'(seed별 자동) */
  parameterMode: 'fixed' | 'auto';
  /** 산정 방법 식별자(auto) */
  method?: string;
  /** 평가한 후보 조합 수(auto) */
  candidateCount?: number;
  /** 선정 조합의 품질 점수(auto) */
  score?: number;
  /** suggest 초기 추천값(auto) */
  suggested?: { minCooc: number; simMin: number; muMin: number };
}

/** seed 유도 국소 퍼지 군집 결과(전역 밀도 아님) */
export interface PlaceClusterResult {
  /** 기준 표기(seed) */
  seed: string;
  /** 공기 단위 */
  scope: 'article' | 'paragraph';
  /** 적용 파라미터(실제값) */
  params: { simMin: number; muMin: number; minCooc: number; limit: number };
  /** seed 이웃이 limit로 절단됐는가 */
  truncated: boolean;
  /** 퍼지 군집 목록 */
  clusters: FuzzyPlaceCluster[];
  /** 노이즈 지명(정렬) */
  noise: string[];
  /** 파라미터 선정 근거(재현성·투명성) */
  selection?: PlaceClusterSelection;
}

/** 군집(co-occurrence) 결과 1건 */
export interface ClusterNeighbor {
  /** 개체 유형 */
  type: string;
  /** 표기(한자·정자 원문, 불변) */
  surface: string;
  /** 선택 scope 단위 공기(共起) 빈도(article=공기 기사 수 / paragraph=공기 문단 수) */
  count: number;
  /** 간자체 병기(정자와 다를 때만·복사→지도 검색용). 원문 surface는 불변, 표시 전용 */
  simplified?: string;
}

/** 구조화 조회 결과 1건 */
export interface PlaceOccurrence {
  /** 본문 id */
  passageId: number;
  /** 소속 노드 id */
  nodeId: string;
  /** 코퍼스 코드 */
  corpusCode: string;
  /** 노드 제목 */
  nodeTitle: string | null;
  /** materialized path */
  path: string;
}
