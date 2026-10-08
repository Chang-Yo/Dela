// @ 引用读取：普通文件条目以磁盘绝对路径为 id（shared/workspace），旧 UUID 引用继续可用。
import { describe, expect, it, vi } from 'vitest';
import { readCanvasSource } from '../../../canvas/api';
import { readShuiyuanSource } from '../../../shuiyuan/api';
import { readWorkspaceEntry } from '../../../workspace/api';
import { readAskReferences } from '../references';
import type { DocumentContent } from '../../../../shared/documents';

vi.mock('../../../workspace/api', () => ({
  readWorkspaceEntry: vi.fn(async (id: string): Promise<DocumentContent> => ({
    title: id,
    format: 'text',
    text: '正文',
  })),
}));
vi.mock('../../../canvas/api', () => ({
  readCanvasSource: vi.fn(async (): Promise<DocumentContent> => ({
    title: 'canvas',
    format: 'text',
    text: '',
  })),
}));
vi.mock('../../../shuiyuan/api', () => ({
  readShuiyuanSource: vi.fn(async (): Promise<DocumentContent> => ({
    title: 'shuiyuan',
    format: 'text',
    text: '',
  })),
}));

const attachment = () => ({ name: 'a.txt', bytes: Buffer.from('') });

describe('readAskReferences', () => {
  it('绝对路径条目直接按路径读取，uuid 旧引用不变', async () => {
    const { documents } = await readAskReferences(
      ['E:\\proj\\python\\app.py', '0189c431-2a1f-7214-b1a5-1f4de5358b61'],
      [],
      attachment,
    );
    expect(readWorkspaceEntry).toHaveBeenNthCalledWith(1, 'E:\\proj\\python\\app.py');
    expect(readWorkspaceEntry).toHaveBeenNthCalledWith(2, '0189c431-2a1f-7214-b1a5-1f4de5358b61');
    expect(documents[0]).toMatchObject({ key: 'E:\\proj\\python\\app.py', text: '正文' });
  });

  it('相对路径与空 id 不是合法引用', async () => {
    await expect(readAskReferences(['python/app.py'], [], attachment)).rejects.toThrow();
    await expect(readAskReferences([''], [], attachment)).rejects.toThrow();
  });

  it('source: 前缀不经条目校验，直接走资料读取', async () => {
    await readAskReferences(['source:canvas:abc'], [], attachment);
    expect(readCanvasSource).toHaveBeenCalled();
    expect(readWorkspaceEntry).not.toHaveBeenCalledWith('source:canvas:abc');
    expect(readShuiyuanSource).not.toHaveBeenCalled();
  });
});
