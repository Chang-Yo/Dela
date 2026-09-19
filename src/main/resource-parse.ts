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

/** 整页渲染出的 JPEG；供 agent 以图片消息附给视觉模型。 */
export interface RenderedPdfPage {
  page: number;
  jpeg: Uint8Array;
}

// 页渲染远贵于文本提取，同样以路径 + 修改时间 + 大小为键做进程内小缓存。
const renderCache = new Map<string, Uint8Array>();
const RENDER_CACHE_LIMIT = 12;

/** pdfjs 画布工厂协议（create/reset/destroy）的 @napi-rs/canvas 实现。 */
function napiCanvasFactory(canvas: typeof import('@napi-rs/canvas')) {
  return class {
    create(width: number, height: number) {
      if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
      const instance = canvas.createCanvas(width, height);
      return {
        canvas: instance,
        context: instance.getContext('2d'),
      };
    }
    reset(
      entry: { canvas: { width: number; height: number } | null },
      width: number,
      height: number,
    ) {
      if (!entry.canvas) throw new Error('Canvas is not specified');
      if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
      entry.canvas.width = width;
      entry.canvas.height = height;
    }
    destroy(entry: { canvas: { width: number; height: number } | null; context: unknown }) {
      if (!entry.canvas) throw new Error('Canvas is not specified');
      entry.canvas.width = entry.canvas.height = 0;
      entry.canvas = null;
      entry.context = null;
    }
  };
}

/**
 * 把指定页整页渲染为 JPEG（白底，最长边约 1600px，质量 0.85）。
 * pdfjs 的 Node 分支依赖 createRequire(import.meta.url) 加载 @napi-rs/canvas，
 * 但主进程打包后 import.meta.url 被 rolldown 置空，其自带的画布工厂与
 * DOMMatrix polyfill 都会静默失效——这里显式注入工厂并补齐 polyfill。
 */
export async function renderPdfPages(
  path: string,
  pages: number[],
): Promise<{ totalPages: number; pages: RenderedPdfPage[] }> {
  const wanted = [...new Set(pages)].sort((a, b) => a - b);
  if (wanted.length === 0) throw new Error('请至少指定一个页码');
  const stats = await stat(path);
  const baseKey = `${path}|${stats.mtimeMs}|${stats.size}`;
  const rendered: RenderedPdfPage[] = [];
  const missing: number[] = [];
  for (const page of wanted) {
    const cached = renderCache.get(`${baseKey}|${page}`);
    if (cached) rendered.push({ page, jpeg: cached });
    else missing.push(page);
  }
  const pdfjs = await loadPdfjs();
  const canvasModule = await import('@napi-rs/canvas');
  // 进程内 worker 与显示层都用 globalThis.DOMMatrix；缺失时补 pdfjs 本想补的 polyfill。
  const globals = globalThis as typeof globalThis & { DOMMatrix?: unknown };
  globals.DOMMatrix ??= canvasModule.DOMMatrix;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await readFile(path)),
    verbosity: 0,
    CanvasFactory: napiCanvasFactory(canvasModule),
  });
  try {
    const document = await task.promise;
    for (const page of missing) {
      if (page < 1 || page > document.numPages)
        throw new Error(`页码 ${page} 超出范围（共 ${document.numPages} 页）`);
    }
    for (const page of missing) {
      const pdfPage = await document.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(2.5, Math.max(1, 1600 / Math.max(base.width, base.height)));
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasModule.createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const context = canvas.getContext('2d');
      // PDF 页可能是透明背景，先铺白底，否则编码出的 JPEG 是黑底。
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // pdfjs 的渲染类型面向 DOM canvas；@napi-rs/canvas 在 Node 下与其同构。
      await pdfPage.render({ canvas: canvas as never, viewport }).promise;
      const jpeg = new Uint8Array(canvas.toBuffer('image/jpeg', 0.85));
      if (renderCache.size >= RENDER_CACHE_LIMIT)
        renderCache.delete(renderCache.keys().next().value!);
      renderCache.set(`${baseKey}|${page}`, jpeg);
      rendered.push({ page, jpeg });
      pdfPage.cleanup();
    }
    return { totalPages: document.numPages, pages: rendered.sort((a, b) => a.page - b.page) };
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
