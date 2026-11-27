import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../../../modules/workspace/main/read-resource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../modules/workspace/main/read-resource')>()),
  readDocument: vi.fn(),
}));
vi.mock('../api', () => ({
  cachedFile: vi.fn(),
  canvasFilePath: vi.fn(),
  canvasPreviewPath: vi.fn(),
  getSource: vi.fn(),
  readCanvasPage: vi.fn(),
  readCanvasSource: vi.fn(),
}));

import { cachedFile, getSource, readCanvasSource } from '../api';
import { canvasWorkspaceSource } from '../resources';

const root = mkdtempSync(join(tmpdir(), 'dela-canvas-resource-'));
beforeEach(() => vi.clearAllMocks());
afterAll(() => rmSync(root, { recursive: true, force: true }));

it('Agent 读取 Canvas 文件只给元数据，图片才下载并内联，都不走 GUI 预览', async () => {
  vi.mocked(getSource).mockReturnValue({
    id: 'canvas-file:7',
    kind: 'file',
    courseId: 1,
    title: '课件.pptx',
  });
  expect(await canvasWorkspaceSource.read('canvas-file:7')).toEqual({
    title: '课件.pptx',
    format: 'file',
  });
  expect(cachedFile).not.toHaveBeenCalled();

  const picture = join(root, 'picture.jpg');
  writeFileSync(picture, Buffer.from([1, 2, 3]));
  vi.mocked(getSource).mockReturnValue({
    id: 'canvas-file:8',
    kind: 'file',
    courseId: 1,
    title: 'picture.jpg',
    mime: 'image/jpeg',
  });
  vi.mocked(cachedFile).mockResolvedValue({ path: picture, mime: 'image/jpeg' });
  expect(await canvasWorkspaceSource.read('canvas-file:8')).toMatchObject({
    format: 'image',
    bytes: Buffer.from([1, 2, 3]),
    mime: 'image/jpeg',
  });
  expect(readCanvasSource).not.toHaveBeenCalled();
});
