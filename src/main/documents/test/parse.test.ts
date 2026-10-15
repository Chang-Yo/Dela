import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../parse';
import { classifyOfficeFile } from '../parse';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

it('uses content detection for Office previews even when the extension is absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dela-file-type-'));
  try {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['中文', 42]]), '数据');
    const path = join(directory, 'download');
    await writeFile(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    expect(await classifyOfficeFile(path)).toBe('xlsx');
    await writeFile(path, 'not an office document');
    expect(await classifyOfficeFile(path)).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

describe('web PDF text extraction', () => {
  it('extracts PDF text with page sections', { timeout: 30_000 }, async () => {
    const parsed = await extractPdfText(minimalPdf('Hello Dela'));
    expect(parsed).toMatchObject({ kind: 'pdf', pages: 1, hasTextLayer: true });
    expect(parsed.text).toContain('[第 1 页]');
    expect(parsed.text).toContain('Hello Dela');
  });

  it('detects PDFs without a text layer as scanned', async () => {
    const parsed = await extractPdfText(minimalPdf(''));
    expect(parsed.hasTextLayer).toBe(false);
  });
});
