import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractDocumentBytes, parsableDocumentExtension } from './resource-parse';

/** 构造最小可用 zip：deflate 条目 + 中央目录，CRC 置零（解析器不校验）。 */
function buildZip(entries: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(content, 'utf8'));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(content), 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(Buffer.byteLength(content), 24);
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

  it('extracts PDF text with page sections', async () => {
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
