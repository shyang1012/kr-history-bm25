/**
 * @Project: kr-history-bm25
 * @File: integration-parse.test.ts
 * @Description: 실제 사서 XML 파싱 통합 스모크. source/ 코퍼스가 있을 때만 실행(없으면 skip).
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/parser/document-parser';

const sourceRoot = fileURLToPath(new URL('../source', import.meta.url));
const hasSource = existsSync(sourceRoot);

const CASES = [
  {
    dir: '교육부 국사편찬위원회_한국사데이터베이스 정보_삼국사기 원문_20221103',
    file: 'sg_037.xml',
  },
  { dir: '교육부 국사편찬위원회_한국사데이터베이스 정보_고려사절요 원문_20230518', file: null },
];

describe.skipIf(!hasSource)('실제 사서 파싱 스모크', () => {
  it('삼국사기 지리지(sg_037) — 노드·본문·지명 색인이 풍부하다', () => {
    const path = `${sourceRoot}/${CASES[0].dir}/${CASES[0].file}`;
    const doc = parseDocument(readFileSync(path, 'utf-8'));
    expect(doc.nodes.length).toBeGreaterThan(0);
    expect(doc.passages.length).toBeGreaterThan(0);
    const places = doc.passages.flatMap((p) => p.mentions).filter((m) => m.type === '지명');
    expect(places.length).toBeGreaterThan(50);
  });

  it('고려사절요(DTD 2종 중 하나) 첫 파일이 오류 없이 파싱된다', () => {
    const dir = `${sourceRoot}/${CASES[1].dir}`;
    const first = readdirSync(dir).find((f) => f.endsWith('.xml'));
    expect(first).toBeDefined();
    const doc = parseDocument(readFileSync(`${dir}/${first}`, 'utf-8'));
    expect(doc.nodes.length).toBeGreaterThan(0);
  });
});
