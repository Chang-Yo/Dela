import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  classifyOfficeFile,
  classifyOfficeZip,
  extractDocumentBytes,
  parsableDocumentExtension,
  renderPdfPages,
} from '../resource-parse';

/** 构造最小可用 zip：deflate 条目 + 中央目录，CRC 置零（解析器不校验）。 */
function buildZip(entries: Record<string, string | Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const count = Object.keys(entries).length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

/** 无 xref 的最小单页 PDF；pdf.js 会重建对象索引并提取文本。 */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      `4 0 obj<</Length ${Buffer.byteLength(stream)}>>stream\n${stream}\nendstream\nendobj`,
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'trailer<</Size 6/Root 1 0 R>>',
    ].join('\n'),
  );
}

describe('resource parsing', () => {
  it('dispatches by file extension', () => {
    expect(parsableDocumentExtension('a.PDF')).toBe('pdf');
    expect(parsableDocumentExtension('b.DocX')).toBe('docx');
    expect(parsableDocumentExtension('c.pptx')).toBe('pptx');
    expect(parsableDocumentExtension('d.txt')).toBeNull();
    expect(parsableDocumentExtension('noext')).toBeNull();
  });

  it('classifies OOXML zips by central directory entries', () => {
    expect(classifyOfficeZip(buildZip({ 'word/document.xml': '<w/>' }))).toBe('docx');
    expect(classifyOfficeZip(buildZip({ 'ppt/slides/slide1.xml': '<p/>' }))).toBe('pptx');
    expect(classifyOfficeZip(buildZip({ 'xl/workbook.xml': '<x/>' }))).toBe('xlsx');
    expect(classifyOfficeZip(buildZip({ 'hello.txt': 'x' }))).toBeNull();
    expect(classifyOfficeZip(Buffer.from('not a zip'))).toBeNull();
  });

  it('classifies office files from disk, tolerating trailing bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dela-office-'));
    try {
      const docx = buildZip({ 'word/document.xml': '<w:document/>' });
      const docxPath = join(dir, 'doc.docx');
      await writeFile(docxPath, docx);
      expect(await classifyOfficeFile(docxPath)).toBe('docx');
      // 部分工具会在 zip 末尾追加数据；EOCD 扫描应仍能识别。
      const padded = Buffer.concat([docx, Buffer.alloc(64, 0)]);
      const paddedPath = join(dir, 'padded.docx');
      await writeFile(paddedPath, padded);
      expect(await classifyOfficeFile(paddedPath)).toBe('docx');
      const plain = join(dir, 'plain.txt');
      await writeFile(plain, 'hello');
      expect(await classifyOfficeFile(plain)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('classifies office files larger than the tail window (randomBytes keep zip big)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dela-office-big-'));
    try {
      // 1.5MB 不可压缩内容让磁盘文件超过 1MB 尾窗，验证中央目录偏移按尾窗起点换算。
      const big = buildZip({
        'word/document.xml': '<w:document/>',
        'word/media/image1.bin': randomBytes(1536 * 1024),
      });
      expect(big.length).toBeGreaterThan(1024 * 1024);
      const path = join(dir, 'big.docx');
      await writeFile(path, big);
      expect(await classifyOfficeFile(path)).toBe('docx');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported document types before parsing', async () => {
    await expect(extractDocumentBytes(Buffer.from('x'), 'a.txt')).rejects.toThrow(
      '不支持的文档类型',
    );
  });

  it('extracts DOCX paragraphs, tabs and entities', async () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> world &amp; more &lt;tag&gt;</w:t></w:r></w:p>' +
      '<w:p><w:r><w:tab/></w:r><w:r><w:t>indented</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const parsed = await extractDocumentBytes(buildZip({ 'word/document.xml': xml }), 'doc.docx');
    expect(parsed).toMatchObject({ kind: 'docx', hasTextLayer: true });
    expect(parsed.text).toBe('Hello world & more <tag>\n\tindented');
  });

  it('orders PPTX slides numerically and prefixes slide numbers', async () => {
    const slide = (text: string) =>
      `<p:sld><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sld>`;
    const entries = {
      '[Content_Types].xml': '<Types/>',
      'ppt/slides/slide1.xml': slide('第一页'),
      'ppt/slides/slide10.xml': slide('第十页'),
      'ppt/slides/slide2.xml': slide('第二页'),
    };
    const parsed = await extractDocumentBytes(buildZip(entries), 'deck.pptx');
    expect(parsed.pages).toBe(3);
    expect(parsed.text.indexOf('幻灯片 1]')).toBeLessThan(parsed.text.indexOf('幻灯片 2]'));
    expect(parsed.text.indexOf('幻灯片 2]')).toBeLessThan(parsed.text.indexOf('幻灯片 10]'));
    expect(parsed.text).toContain('第十页');
  });

  it('extracts PDF text with page sections', { timeout: 30_000 }, async () => {
    const parsed = await extractDocumentBytes(minimalPdf('Hello Dela'), 'lecture.pdf');
    expect(parsed).toMatchObject({ kind: 'pdf', pages: 1, hasTextLayer: true });
    expect(parsed.text).toContain('[第 1 页]');
    expect(parsed.text).toContain('Hello Dela');
  });

  it('detects PDFs without a text layer as scanned', async () => {
    const parsed = await extractDocumentBytes(minimalPdf(''), 'scan.pdf');
    expect(parsed.hasTextLayer).toBe(false);
  });

  it('rejects broken archives with a clear error', async () => {
    await expect(extractDocumentBytes(Buffer.from('not a zip'), 'x.docx')).rejects.toThrow(
      '压缩包损坏',
    );
  });
});

describe('PDF page rendering', () => {
  /** 渲染走文件路径：建临时目录放 fixture，结束后清理。 */
  async function withPdfFile(text: string, run: (path: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'dela-pdf-'));
    try {
      const path = join(dir, 'lecture.pdf');
      await writeFile(path, minimalPdf(text));
      await run(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('renders whole pages as JPEG with deduplicated page numbers', async () => {
    await withPdfFile('Render me', async (path) => {
      const rendered = await renderPdfPages(path, [1, 1]);
      expect(rendered.totalPages).toBe(1);
      expect(rendered.pages).toHaveLength(1);
      const jpeg = rendered.pages[0]!.jpeg;
      expect(jpeg[0]).toBe(0xff); // JPEG magic
      expect(jpeg[1]).toBe(0xd8);
      expect(jpeg.length).toBeGreaterThan(100);
    });
  });

  it('rejects page numbers outside the document', async () => {
    await withPdfFile('x', async (path) => {
      await expect(renderPdfPages(path, [5])).rejects.toThrow('超出范围');
    });
  });

  it('rejects empty page lists before touching the file', async () => {
    await expect(renderPdfPages('missing.pdf', [])).rejects.toThrow('请至少指定一个页码');
  });
});
