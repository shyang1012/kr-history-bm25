/**
 * @Project: kr-history-bm25
 * @File: document-parser.ts
 * @Description: 사서 XML 1권을 단일 SAX 패스로 파싱해 계층 노드·본문(paragraph)·색인 출현·주석을 추출한다.
 *               한자 원문만 대상으로 하며, 주석(교감주·원주)은 본문과 분리한다. (node-walker + passage-extractor 통합)
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { ParsedDocument, ParsedNode, ParsedPassage, ParsedMention } from '../types';
import { parseXml } from './xml-reader';

/** level 요소 이름 → 레벨 번호 */
const LEVEL_NO: Record<string, number> = {
  level1: 1,
  level2: 2,
  level3: 3,
  level4: 4,
  level5: 5,
  level6: 6,
};

/** content@type가 번역/주석 계열이면 본문 색인에서 제외 */
const NON_ORIGINAL_CONTENT = /번역|역문|주석/;

/** 파싱 중 열린 index 요소 상태 */
interface OpenIndex {
  type: string;
  startOffset: number;
  attrs: Record<string, string> | null;
}

/**
 * 사서 XML 원문을 파싱한다.
 * @param xml - XML 문자열
 * @returns 노드·본문 파싱 결과
 */
export function parseDocument(xml: string): ParsedDocument {
  const nodes: ParsedNode[] = [];
  const passages: ParsedPassage[] = [];

  const nodeStack: ParsedNode[] = [];
  const elementStack: string[] = [];
  const contentTypeStack: string[] = [];
  const childCountByParent = new Map<string, number>();

  let titleTarget: ParsedNode | null = null; // mainTitle을 받을 수 있는 노드
  let inMainTitle = false;
  let mainTitleBuf = '';

  let para: ParsedPassage | null = null;
  let openIndex: OpenIndex | null = null;
  let annotationDepth = 0;
  let annotationType: string | null = null;
  let annotationBuf = '';
  const paragraphSeqByNode = new Map<string, number>();

  const currentNode = (): ParsedNode | null => nodeStack[nodeStack.length - 1] ?? null;
  const parentName = (): string => elementStack[elementStack.length - 1] ?? '';

  const startNode = (name: string, attrs: Record<string, string>): void => {
    const parent = currentNode();
    const parentKey = parent ? parent.id : 'ROOT';
    const seq = childCountByParent.get(parentKey) ?? 0;
    childCountByParent.set(parentKey, seq + 1);
    const id = attrs.id ?? `${parentKey}_${seq}`;
    const node: ParsedNode = {
      id,
      parentId: parent ? parent.id : null,
      levelNo: LEVEL_NO[name] ?? 0,
      type: attrs.type ?? null,
      value: attrs.value ?? null,
      wangmyeong: attrs['왕명'] ?? null,
      reignYear: attrs['재위년도'] ?? null,
      title: null,
      path: parent ? `${parent.path}/${id}` : id,
      seq,
    };
    nodes.push(node);
    nodeStack.push(node);
    titleTarget = node; // 새 레벨: 첫 mainTitle 수신 대상
  };

  const startParagraph = (): void => {
    const node = currentNode();
    if (!node) {
      return;
    }
    const nearestContentType = contentTypeStack[contentTypeStack.length - 1] ?? '';
    if (parentName() !== 'content' || NON_ORIGINAL_CONTENT.test(nearestContentType)) {
      return;
    }
    const seq = paragraphSeqByNode.get(node.id) ?? 0;
    paragraphSeqByNode.set(node.id, seq + 1);
    para = { nodeId: node.id, seq, textHan: '', mentions: [], annotations: [] };
  };

  const finishParagraph = (): void => {
    if (para && para.textHan.length > 0) {
      passages.push(para);
    }
    para = null;
    openIndex = null;
  };

  const onOpenTag = (name: string, attrs: Record<string, string>): void => {
    if (name in LEVEL_NO) {
      startNode(name, attrs);
    } else if (name === 'content') {
      contentTypeStack.push(attrs.type ?? '');
    } else if (name === 'mainTitle' && titleTarget && titleTarget.title === null) {
      inMainTitle = true;
      mainTitleBuf = '';
    } else if (name === 'paragraph' && annotationDepth === 0 && !para) {
      startParagraph();
    } else if (name === 'annotation') {
      if (annotationDepth === 0) {
        annotationType = attrs.type ?? null;
        annotationBuf = '';
      }
      annotationDepth += 1;
    } else if (name === 'index' && para && annotationDepth === 0) {
      openIndex = {
        type: attrs.type ?? '기타',
        startOffset: para.textHan.length,
        attrs: pickIndexAttrs(attrs),
      };
    }
    elementStack.push(name);
  };

  const onText = (text: string): void => {
    if (annotationDepth > 0) {
      annotationBuf += text;
      return;
    }
    if (inMainTitle) {
      mainTitleBuf += text;
      return;
    }
    if (para) {
      para.textHan += text.replace(/\s+/g, '');
    }
  };

  const onCloseTag = (name: string): void => {
    elementStack.pop();
    if (name === 'index' && openIndex && para) {
      recordMention(para, openIndex);
      openIndex = null;
    } else if (name === 'annotation') {
      annotationDepth -= 1;
      if (annotationDepth === 0) {
        const collapsed = annotationBuf.replace(/\s+/g, ' ').trim();
        if (para && collapsed.length > 0) {
          para.annotations.push({ type: annotationType, text: collapsed });
        }
        annotationType = null;
        annotationBuf = '';
      }
    } else if (name === 'mainTitle' && inMainTitle) {
      inMainTitle = false;
      if (titleTarget && titleTarget.title === null) {
        titleTarget.title = mainTitleBuf.trim();
        titleTarget = null;
      }
    } else if (name === 'content') {
      contentTypeStack.pop();
    } else if (name === 'paragraph' && para) {
      finishParagraph();
    } else if (name in LEVEL_NO) {
      nodeStack.pop();
    }
  };

  parseXml(xml, { onOpenTag, onText, onCloseTag });
  return { nodes, passages };
}

/** <index>의 유용한 부가 속성만 추린다(sort/num/name/id 등) */
function pickIndexAttrs(attrs: Record<string, string>): Record<string, string> | null {
  const keys = ['sort', 'num', 'name', 'id', 'ref', 'namealias'];
  const picked: Record<string, string> = {};
  for (const k of keys) {
    if (attrs[k] !== undefined) {
      picked[k] = attrs[k];
    }
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

/** 열린 index 구간을 mention으로 확정해 passage에 추가한다 */
function recordMention(paragraph: ParsedPassage, open: OpenIndex): void {
  const surface = paragraph.textHan.slice(open.startOffset);
  if (surface.length === 0) {
    return;
  }
  const mention: ParsedMention = {
    type: open.type,
    surface,
    charOffset: open.startOffset,
    attrs: open.attrs,
  };
  paragraph.mentions.push(mention);
}
