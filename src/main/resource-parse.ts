import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export type ParsedDocumentKind = 'pdf' | 'docx' | 'pptx';

export interface ParsedDocument {
  kind: ParsedDocumentKind;
  /** 按页/幻灯片分节的全文；无文本层时为空壳分节。 */
  text: string;
  pages: number;
  /** 扫描件或图片导出没有文本层，无法提取文字。 */
  hasTextLayer: boolean;
}

/** 按扩展名判断是否支持提取；调用方可在读取文件前决定是否走解析路径。 */
export function parsableDocumentExtension(name: string): ParsedDocumentKind | null {
  const extension = extname(name).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.docx') return 'docx';
  if (extension === '.pptx') return 'pptx';
  return null;
}

export async function extractDocumentBytes(
  bytes: Uint8Array,
  name: string,
): Promise<ParsedDocument> {
  const kind = parsableDocumentExtension(name);
  if (!kind) throw new Error('不支持的文档类型：仅支持 PDF、DOCX、PPTX');
  if (kind === 'pdf') return extractPdfText(bytes);
  const entries = readZipEntries(Buffer.from(bytes), (entry) =>
    kind === 'docx' ? entry === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(entry),
  );
  if (kind === 'docx') {
    const document = entries.get('word/document.xml');
    if (!document) throw new Error('DOCX 缺少 word/document.xml，可能已损坏');
    const text = docxText(document.toString('utf8'));
    return { kind, text, pages: 1, hasTextLayer: text.length > 0 };
  }
  const slides = [...entries.keys()]
    .map((entry) => Number(/ppt\/slides\/slide(\d+)\.xml$/.exec(entry)![1]))
    .sort((a, b) => a - b);
  if (slides.length === 0) throw new Error('PPTX 没有可读取的幻灯片');
  const text = slides
    .map(
      (number) =>
        `[幻灯片 ${number}]\n${slideText(entries.get(`ppt/slides/slide${number}.xml`)!.toString('utf8'))}`,
    )
    .join('\n\n');
  return { kind, text, pages: slides.length, hasTextLayer: text.length > 0 };
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // 主进程没有 Worker 环境：先把 WorkerMessageHandler 挂到 globalThis，
      // pdf.js 检测到后直接在进程内解析，不再执行运行时相对路径的 worker import。
      (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker =
        await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      return import('pdfjs-dist/legacy/build/pdf.mjs');
    })();
  }
  return pdfjsPromise;
}

async function extractPdfText(bytes: Uint8Array): Promise<ParsedDocument> {
  const pdfjs = await loadPdfjs();
  // pdf.js 明确拒绝 Buffer（Node 检测分支），复制为普通 Uint8Array；
  // 副作用是调用方的缓冲不会被 transfer。
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const document = await task.promise;
    const sections: string[] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = '';
      for (const item of content.items) {
        if ('str' in item) pageText += item.str + (item.hasEOL ? '\n' : '');
      }
      pageText = pageText.replace(/\n{3,}/g, '\n\n').trim();
      characters += pageText.length;
      sections.push(`[第 ${pageNumber} 页]\n${pageText}`);
      page.cleanup();
    }
    return {
      kind: 'pdf',
      text: sections.join('\n\n'),
      pages: document.numPages,
      hasTextLayer: characters > 0,
    };
  } finally {
    await task.destroy();
  }
}

/**
 * 读取 zip 中央目录并解出匹配条目。OOXML 文档（DOCX/PPTX）是 deflate 压缩的 zip + XML，
 * 这里只实现文档解析所需的子集：不校验 CRC，不支持加密与 Zip64。
 */
function readZipEntries(bytes: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1;
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= earliest; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('压缩包损坏：找不到目录结尾');
  if (bytes.readUInt32LE(eocd + 16) === 0xffffffff) throw new Error('暂不支持超过 4GB 的文档');
  const entryCount = bytes.readUInt16LE(eocd + 10);
  let cursor = bytes.readUInt32LE(eocd + 16);
  const result = new Map<string, Buffer>();
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('压缩包损坏：目录不完整');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name) || result.has(name)) continue;
    if (flags & 1) throw new Error('暂不支持加密文档');
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error('压缩包损坏：条目头不完整');
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) result.set(name, Buffer.from(data));
    else if (method === 8) result.set(name, inflateRawSync(data));
    else throw new Error('压缩包损坏：未知压缩方式');
  }
  return result;
}

/** DOCX 段落文本：段落换行，tab/br 转义，w:t 文本节点拼接。 */
function docxText(xml: string): string {
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/g) ?? [];
  return paragraphs
    .map((paragraph) => {
      let line = '';
      for (const token of paragraph.match(
        /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g,
      ) ?? []) {
        if (token.startsWith('<w:tab')) line += '\t';
        else if (token.startsWith('<w:br')) line += '\n';
        else
          line += decodeXmlEntities(token.slice(token.indexOf('>') + 1, token.lastIndexOf('</')));
      }
      return line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** PPTX 幻灯片文本：段落换行，a:t 文本节点拼接。 */
function slideText(xml: string): string {
  const paragraphs = xml.match(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>|<a:p\/>/g) ?? [];
  return paragraphs
    .map((paragraph) => {
      let line = '';
      for (const token of paragraph.match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|<a:br\b[^>]*\/?>/g) ??
        []) {
        if (token.startsWith('<a:br')) line += '\n';
        else
          line += decodeXmlEntities(token.slice(token.indexOf('>') + 1, token.lastIndexOf('</')));
      }
      return line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      safeCodePoint(parseInt(hex, 16), `&#x${hex};`),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) => safeCodePoint(Number(decimal), `&#${decimal};`))
    .replaceAll('&amp;', '&');
}

function safeCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

// 同一文件的分页读取不应重复解析；以路径 + 修改时间 + 大小为键的进程内小缓存。
const parseCache = new Map<string, ParsedDocument>();
const PARSE_CACHE_LIMIT = 6;

export async function parseDocumentFile(path: string): Promise<ParsedDocument> {
  const stats = await stat(path);
  const key = `${path}|${stats.mtimeMs}|${stats.size}`;
  const cached = parseCache.get(key);
  if (cached) return cached;
  const parsed = await extractDocumentBytes(await readFile(path), path);
  if (parseCache.size >= PARSE_CACHE_LIMIT) {
    parseCache.delete(parseCache.keys().next().value!);
  }
  parseCache.set(key, parsed);
  return parsed;
}
