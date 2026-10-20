import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../operations', () => ({
  statRemoteFile: vi.fn(),
  readRemoteRange: vi.fn(),
}));

import { remoteAssetUrl } from '../../../shared/remotes';
import { readRemoteDocument } from '../documents';
import { readRemoteRange, statRemoteFile } from '../operations';

const target = { host: 'user@host', port: null, keyPath: null };
const stat = vi.mocked(statRemoteFile);
const read = vi.mocked(readRemoteRange);
const entry = (size: number, modifiedAt: number | null = 1000) => ({
  name: 'file',
  directory: false,
  size,
  modifiedAt,
});

describe('远端文件预览', () => {
  beforeEach(() => vi.clearAllMocks());

  it('文本只读头部：小文件全文，大文件截断并说明', async () => {
    stat.mockResolvedValue(entry(5));
    read.mockResolvedValue(Buffer.from('hello'));
    const doc = await readRemoteDocument('p-1', target, '/home/u/proj/a.txt');
    expect(read).toHaveBeenCalledWith(target, '/home/u/proj/a.txt', 0, 5);
    expect(doc).toMatchObject({
      title: 'a.txt',
      format: 'text',
      text: 'hello',
      revision: '1000-5',
    });

    stat.mockResolvedValue(entry(9 * 1024 * 1024, 2000));
    read.mockResolvedValue(Buffer.from('head'));
    const big = await readRemoteDocument('p-1', target, '/home/u/proj/b.txt');
    expect(read).toHaveBeenCalledWith(target, '/home/u/proj/b.txt', 0, 4 * 1024 * 1024);
    expect(big.text).toContain('head');
    expect(big.text).toContain('只读了前 4 MB');
    expect(big.revision).toBe('2000-9437184');
  });

  it('Markdown 与代码扩展名按与本地同一套规则判定', async () => {
    stat.mockResolvedValue(entry(3));
    read.mockResolvedValue(Buffer.from('# t'));
    expect((await readRemoteDocument('p-1', target, '/home/u/proj/README.md')).format).toBe(
      'markdown',
    );
    expect((await readRemoteDocument('p-1', target, '/home/u/proj/src/main.ts')).format).toBe(
      'text',
    );
  });

  it('.env 系列与无扩展名文件按文本读取', async () => {
    stat.mockResolvedValue(entry(4));
    read.mockResolvedValue(Buffer.from('A=1\n'));
    for (const name of ['.env', '.env.example', '.gitignore', 'Makefile']) {
      const doc = await readRemoteDocument('p-1', target, `/home/u/proj/${name}`);
      expect(doc.format).toBe('text');
      expect(doc.text).toBe('A=1\n');
    }
  });

  it('PDF/Office 只给按 Range 分块的地址，字节不拉回本地', async () => {
    stat.mockResolvedValue(entry(2048, 7));
    const pdf = await readRemoteDocument('p-1', target, '/home/u/proj/manual.pdf');
    expect(pdf.previewUrl).toBe(
      'dela-resource://remote/p-1?path=%2Fhome%2Fu%2Fproj%2Fmanual.pdf&v=7-2048',
    );
    expect(pdf.format).toBe('pdf');
    expect(pdf.mime).toBe('application/pdf');
    expect(pdf.bytes).toBeUndefined();

    const docx = await readRemoteDocument('p-1', target, '/home/u/proj/a.docx');
    expect(docx.format).toBe('docx');
    expect(docx.mime).toContain('wordprocessingml');
    expect(read).not.toHaveBeenCalled();
  });

  it('图片在上限内直传字节，超过上限直接报错', async () => {
    stat.mockResolvedValue(entry(4, 3));
    read.mockResolvedValue(Buffer.from([1, 2, 3, 4]));
    const image = await readRemoteDocument('p-1', target, '/home/u/proj/logo.png');
    expect(image.format).toBe('image');
    expect([...(image.bytes ?? [])]).toEqual([1, 2, 3, 4]);
    expect(image.mime).toBe('image/png');

    stat.mockResolvedValue(entry(40 * 1024 * 1024));
    await expect(readRemoteDocument('p-1', target, '/home/u/proj/huge.png')).rejects.toThrow(
      '预览上限',
    );
  });
});

describe('远端 Markdown 的相对图片', () => {
  it('按 Markdown 所在目录解析；越界的相对路径保持原样', () => {
    expect(remoteAssetUrl('p-1', '/home/u/proj', '/home/u/proj/docs/a.md', 'img/x.png')).toBe(
      'dela-resource://remote-raw/p-1?path=%2Fhome%2Fu%2Fproj%2Fdocs%2Fimg%2Fx.png',
    );
    expect(remoteAssetUrl('p-1', '/home/u/proj', '/home/u/proj/docs/a.md', '../top.png')).toBe(
      'dela-resource://remote-raw/p-1?path=%2Fhome%2Fu%2Fproj%2Ftop.png',
    );
    expect(remoteAssetUrl('p-1', '/home/u/proj', '/home/u/proj/a.md', '../../etc/passwd')).toBe(
      '../../etc/passwd',
    );
    expect(remoteAssetUrl('p-1', '/home/u/proj', '/home/u/proj/a.md', 'https://x/y.png')).toBe(
      'https://x/y.png',
    );
  });
});
