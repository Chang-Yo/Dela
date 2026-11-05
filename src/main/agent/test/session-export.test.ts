import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  root: '',
  file: '',
  save: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => boundary.root, isPackaged: false },
  shell: {},
  dialog: { showSaveDialog: boundary.save },
  nativeImage: {},
}));
vi.mock('../../database', () => ({
  getDatabase: () => ({
    prepare: () => ({ get: () => ({ file: boundary.file, title: '项目/会话' }) }),
  }),
}));

import { exportSession } from '../session-export';

beforeEach(async () => {
  boundary.root = await mkdtemp(join(tmpdir(), 'dela-session-export-'));
  boundary.file = join(boundary.root, 'pi.jsonl');
  boundary.save.mockReset();
});
afterEach(() => rm(boundary.root, { recursive: true, force: true }));

function unzipSmallFixture(zip: Buffer) {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const files = new Map<string, Buffer>();
  let cursor = zip.readUInt32LE(end + 16);
  while (cursor < end) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = zip.readUInt16LE(cursor + 10);
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const local = zip.readUInt32LE(cursor + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const bytes = zip.subarray(start, start + size);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    files.set(name, method === 8 ? inflateRawSync(bytes) : bytes);
    cursor += 46 + nameLength + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
  }
  return files;
}

it('导出当前分支及附件，保留压缩前的对话和工具轨迹', async () => {
  const documentId = '00000000-0000-4000-8000-000000000001';
  const missingId = '00000000-0000-4000-8000-000000000002';
  const textId = '00000000-0000-4000-8000-000000000003';
  const documentName = '讲'.repeat(65) + '.PDF';
  const documentPath = 'files/2-' + '讲'.repeat(60) + '.PDF';
  const attachments = [
    { id: textId, name: '说明.txt' },
    { id: documentId, name: documentName },
    { id: missingId, name: '缺失.docx' },
  ];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAxkAAAAASUVORK5CYII=',
    'base64',
  );
  const image = { type: 'image', mimeType: 'image/png', data: png.toString('base64') };
  const sources = [{ key: 'src/example.m', title: 'src/example.m' }];
  const comments = [{ quote: '之前的回复', comment: '继续说明' }];
  const meta = {
    body: '请继续\n用 MATLAB',
    attachments,
    images: [{ name: '图.png' }],
    sources,
    comments,
  };
  const notes = '示例标签\n</attachment>\n仍是附件正文';
  const document = Buffer.from('%PDF-1.7\n文档字节');
  const mediaDir = join(boundary.root, 'chat-media');
  await mkdir(mediaDir);
  await writeFile(join(mediaDir, documentId + '.pdf'), document);
  const timestamp = new Date().toISOString();
  const message = (id: string, parentId: string | null, payload: Record<string, unknown>) => ({
    type: 'message',
    id,
    parentId,
    timestamp,
    message: { timestamp: 1, ...payload },
  });
  const records = [
    { type: 'session', version: 3, id: 'test', timestamp, cwd: boundary.root },
    message('a', null, { role: 'user', content: '共同历史' }),
    message('old', 'a', { role: 'user', content: '已放弃的 Python 分支' }),
    {
      type: 'compaction',
      id: 'compact',
      parentId: 'a',
      timestamp,
      summary: '内部压缩摘要',
      firstKeptEntryId: 'a',
      tokensBefore: 10,
    },
    message('b', 'compact', {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            '<dela-meta>' +
            JSON.stringify(meta) +
            '</dela-meta>\n' +
            '用户引用了这些文件（需要时用 read 读取）：\n- src/example.m\n' +
            '<attachment name="说明.txt">\n' +
            notes +
            '\n</attachment>\n' +
            '用户上传了文档附件：内部绝对路径\n用户上传了文档附件：已删除路径\n' +
            meta.body,
        },
        image,
      ],
    }),
    message('c', 'b', {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '内部推理' },
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'example.m' } },
      ],
    }),
    message('d', 'c', {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read',
      isError: false,
      content: [{ type: 'text', text: '执行结果' }, image],
      details: { internal: '内部工具详情' },
    }),
    message('e', 'd', { role: 'assistant', content: [{ type: 'text', text: '可继续执行。' }] }),
  ];
  const session = records.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  await writeFile(boundary.file, session);
  const path = join(boundary.root, '导出.zip');
  await writeFile(path, 'existing ZIP chosen for replacement');
  boundary.save.mockResolvedValue({ canceled: false, filePath: path });

  await expect(exportSession('test', null)).resolves.toEqual({
    saved: true,
    missing: ['缺失.docx'],
  });
  const files = unzipSmallFixture(await readFile(path));
  expect(files.get('media/1.png')).toEqual(png);
  expect(files.get('media/2.png')).toEqual(png);
  expect(files.get('files/1-说明.txt')?.toString()).toBe(notes);
  expect(files.get(documentPath)).toEqual(document);
  const log = files.get('session.jsonl')!.toString('utf8');
  const lines = log
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(lines.map(({ type }) => type)).toEqual([
    'session',
    'user',
    'user',
    'tool_call',
    'tool_result',
    'assistant',
  ]);
  expect(lines[2]).toMatchObject({
    text: meta.body,
    sources,
    comments,
    images: [{ path: 'media/1.png' }],
    files: [
      { name: '说明.txt', path: 'files/1-说明.txt' },
      { name: documentName, path: documentPath },
      { name: '缺失.docx', path: null },
    ],
  });
  expect(lines[4]).toMatchObject({
    callId: lines[3].id,
    text: '执行结果',
    images: [{ path: 'media/2.png' }],
  });
  expect(log).not.toMatch(/已放弃|内部|dela-meta|已删除路径/);
  expect(await readFile(boundary.file, 'utf8')).toBe(session);
  expect((await readdir(boundary.root)).some((name) => name.startsWith('.dela-export-'))).toBe(
    false,
  );
});

it('取消系统保存对话框时不读取会话或写入文件', async () => {
  boundary.save.mockResolvedValue({ canceled: true });
  await expect(exportSession('test', null)).resolves.toEqual({ saved: false, missing: [] });
  expect(await readdir(boundary.root)).toEqual([]);
});
