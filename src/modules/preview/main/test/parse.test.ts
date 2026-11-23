import { expect, it } from 'vitest';
import { classifyOfficeFile } from '../parse';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { buffer } from 'node:stream/consumers';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipFile } from 'yazl';

function minimalXlsx(): Promise<Buffer> {
  const zip = new ZipFile();
  zip.addBuffer(
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    ),
    '[Content_Types].xml',
  );
  zip.addBuffer(Buffer.from('<workbook/>'), 'xl/workbook.xml');
  zip.end();
  return buffer(zip.outputStream);
}

it('uses content detection for Office previews even when the extension is absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dela-file-type-'));
  try {
    const path = join(directory, 'download');
    await writeFile(path, await minimalXlsx());
    expect(await classifyOfficeFile(path)).toBe('xlsx');
    await writeFile(path, 'not an office document');
    expect(await classifyOfficeFile(path)).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
