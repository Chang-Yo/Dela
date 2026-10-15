import { expect, it } from 'vitest';
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
