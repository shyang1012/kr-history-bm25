/**
 * @Project: kr-history-bm25
 * @File: document-parser.test.ts
 * @Description: 문서 파서 — 노드 트리·본문·색인 출현·주석 분리 검증
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/parser/document-parser';

const xml = readFileSync(fileURLToPath(new URL('./fixtures/sample.xml', import.meta.url)), 'utf-8');
const doc = parseDocument(xml);

describe('parseDocument — 노드', () => {
  it('level1/level2 노드를 계층으로 추출한다', () => {
    expect(doc.nodes).toHaveLength(2);
    const [n1, n2] = doc.nodes;
    expect(n1.id).toBe('t_001');
    expect(n1.levelNo).toBe(1);
    expect(n1.title).toBe('新羅本紀');
    expect(n2.id).toBe('t_001_0010');
    expect(n2.parentId).toBe('t_001');
    expect(n2.levelNo).toBe(2);
    expect(n2.title).toBe('始祖');
    expect(n2.wangmyeong).toBe('赫居世');
    expect(n2.reignYear).toBe('1');
    expect(n2.path).toBe('t_001/t_001_0010');
  });
});

describe('parseDocument — 본문', () => {
  it('paragraph를 본문 단위로 추출하고 표점은 유지, 공백은 제거한다', () => {
    expect(doc.passages).toHaveLength(2);
    const [p0, p1] = doc.passages;
    expect(p0.nodeId).toBe('t_001_0010');
    expect(p0.textHan).toBe('始祖赫居世居西干,國號徐羅伐.');
    expect(p1.textHan).toBe('都金城.');
  });

  it('색인(<index>)을 표기·유형·오프셋으로 기록한다', () => {
    const [p0] = doc.passages;
    expect(p0.mentions).toHaveLength(2);
    expect(p0.mentions[0]).toMatchObject({ type: '이름', surface: '赫居世', charOffset: 2 });
    expect(p0.mentions[1]).toMatchObject({ type: '국명', surface: '徐羅伐' });
    // 오프셋으로 원문을 되짚으면 표기가 일치한다
    expect(p0.textHan.slice(p0.mentions[1].charOffset, p0.mentions[1].charOffset + 3)).toBe(
      '徐羅伐',
    );
  });

  it('주석(annotation)은 본문 textHan에서 제외하고 별도 보존한다', () => {
    const [p0] = doc.passages;
    expect(p0.textHan).not.toContain('본문');
    expect(p0.textHan).not.toContain('卒本');
    expect(p0.annotations).toHaveLength(1);
    expect(p0.annotations[0].type).toBe('교감주');
    expect(p0.annotations[0].text).toContain('卒本');
  });

  it('주석 내부의 <index>는 주 색인 mention으로 잡지 않는다', () => {
    const allSurfaces = doc.passages.flatMap((p) => p.mentions.map((m) => m.surface));
    expect(allSurfaces).not.toContain('卒本');
    expect(allSurfaces).toContain('金城');
  });
});
