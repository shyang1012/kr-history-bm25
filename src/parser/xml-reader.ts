/**
 * @Project: kr-history-bm25
 * @File: xml-reader.ts
 * @Description: saxes 기반 SAX 파서 래퍼. 외부 DTD를 페치하지 않으며(보안), 인라인 요소 순서를 보존한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { SaxesParser, type SaxesTag } from 'saxes';

/** SAX 이벤트 핸들러 집합 */
export interface SaxHandlers {
  /** 여는 태그 */
  onOpenTag: (name: string, attributes: Record<string, string>) => void;
  /** 텍스트 노드 */
  onText: (text: string) => void;
  /** 닫는 태그 */
  onCloseTag: (name: string) => void;
}

/**
 * XML 문자열을 SAX로 파싱한다. DOCTYPE의 SYSTEM DTD는 로드하지 않는다(saxes 기본 동작).
 * @param xml - XML 원문
 * @param handlers - 이벤트 핸들러
 * @throws 파싱 오류 시 예외
 */
export function parseXml(xml: string, handlers: SaxHandlers): void {
  const parser = new SaxesParser({ fileName: 'source.xml' });

  parser.on('error', (err) => {
    throw err;
  });
  parser.on('opentag', (tag: SaxesTag) => {
    // 비-네임스페이스(plain) 모드이므로 attributes는 Record<string, string>
    handlers.onOpenTag(tag.name, tag.attributes as Record<string, string>);
  });
  parser.on('text', (text: string) => {
    handlers.onText(text);
  });
  parser.on('closetag', (tag: SaxesTag) => {
    handlers.onCloseTag(tag.name);
  });

  parser.write(xml).close();
}
