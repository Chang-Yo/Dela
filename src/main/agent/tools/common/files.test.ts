import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileTool, writeFileTool, editFileTool } from './files';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dela-file-tools-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

it('creates, reads and edits an unregistered Markdown file by path', async () => {
  const path = join(directory, 'nested', 'notes.md');
  await writeFileTool.execute({ path, text: 'one\ntwo\n' });
  expect(await readFileTool.execute({ path, offset: 2, limit: 1 })).toMatchObject({
    text: 'two',
    nextOffset: 3,
  });
  await editFileTool.execute({ path, oldText: 'two', newText: 'three' });
  expect(readFileSync(path, 'utf8')).toBe('one\nthree\n');
});

it('resolves relative paths against the run directory and rejects ambiguous edits without writing', async () => {
  writeFileSync(join(directory, 'a.txt'), 'same same');
  await expect(
    editFileTool.execute({ path: 'a.txt', oldText: 'same', newText: 'new' }, { cwd: directory }),
  ).rejects.toThrow('多次');
  expect(readFileSync(join(directory, 'a.txt'), 'utf8')).toBe('same same');
});
