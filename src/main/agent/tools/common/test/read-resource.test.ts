// read_resource 改造后的新路径：水源引用（realtime/degraded）、邮件附件直接提取、
// canvas/workspace 图片输出、邮件读取的契约字段与错误码映射。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../canvas/api', () => ({ readCanvasSource: vi.fn() }));
vi.mock('../../../../mail/api', () => ({ readMailMessage: vi.fn(), mailAttachment: vi.fn() }));
vi.mock('../../../../resource-parse', () => ({
  parseDocumentFile: vi.fn(),
  renderPdfPages: vi.fn(),
  parsableDocumentExtension: (name: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.docx')) return 'docx';
    if (lower.endsWith('.pptx')) return 'pptx';
    return null;
  },
}));
vi.mock('../../../../resources', () => ({
  withResourceFile: vi.fn(async (_source: unknown, consume: (path: string) => unknown) =>
    consume('C:/tmp/fake-attachment'),
  ),
}));
vi.mock('../../../../shuiyuan/api', () => ({ readShuiyuanSource: vi.fn() }));
vi.mock('../../../../workspace/api', () => ({
  readWorkspaceEntry: vi.fn(),
  saveWorkspaceNote: vi.fn(),
  editWorkspaceNote: vi.fn(),
}));

import { readCanvasSource } from '../../../../canvas/api';
import { mailAttachment, readMailMessage } from '../../../../mail/api';
import { parseDocumentFile } from '../../../../resource-parse';
import { withResourceFile } from '../../../../resources';
import { readShuiyuanSource } from '../../../../shuiyuan/api';
import { readWorkspaceEntry } from '../../../../workspace/api';
import { readResourceTool } from '../read-resource';

const noteId = 'da21ec6f-71ae-414c-ae59-7618b0dac93e';

beforeEach(() => vi.resetAllMocks());

describe('read_resource: shuiyuan-topic', () => {
  it('实时读取标 realtime 与最后回帖时间', async () => {
    vi.mocked(readShuiyuanSource).mockResolvedValue({
      title: '选课求助',
      format: 'html',
      text: '<p>正文</p>',
      url: 'https://shuiyuan.sjtu.edu.cn/t/topic/1',
      updatedAt: '2026-09-01T00:00:00Z',
    });
    await expect(
      readResourceTool.execute({ ref: { type: 'shuiyuan-topic', id: 1 } }),
    ).resolves.toEqual({
      ref: { type: 'shuiyuan-topic', id: 1 },
      title: '选课求助',
      format: 'html',
      revision: null,
      url: 'https://shuiyuan.sjtu.edu.cn/t/topic/1',
      freshness: { kind: 'realtime', syncedAt: '2026-09-01T00:00:00Z' },
      text: '<p>正文</p>',
      totalCharacters: 9,
      nextOffset: null,
    });
  });

  it('断网回退摘要时明确标注 degraded 且降为 cached', async () => {
    vi.mocked(readShuiyuanSource).mockResolvedValue({
      title: '选课求助',
      format: 'text',
      text: '本地摘要',
      url: 'https://shuiyuan.sjtu.edu.cn/t/topic/1',
    });
    const result = await readResourceTool.execute({ ref: { type: 'shuiyuan-topic', id: 1 } });
    expect(result).toMatchObject({
      freshness: { kind: 'cached' },
      degraded: true,
      note: expect.stringContaining('回退'),
      text: '本地摘要',
    });
  });
});

describe('read_resource: attachment', () => {
  const ref = { type: 'attachment', messageId: 5, part: '1.2' } as const;

  it('临时提取并解析正文，可分页，realtime 无版本', async () => {
    vi.mocked(mailAttachment).mockReturnValue({
      // 工具只用文件名；row 是 IMAP 行的完整形状，测试里给空壳即可。
      row: {} as ReturnType<typeof mailAttachment>['row'],
      attachment: { filename: '作业.pdf', size: 1024, part: '1.2' },
      part: '1.2',
    });
    vi.mocked(parseDocumentFile).mockResolvedValue({
      kind: 'pdf',
      text: 'abcdef',
      pages: 2,
      hasTextLayer: true,
    });
    await expect(readResourceTool.execute({ ref, offset: 2, limit: 2 })).resolves.toMatchObject({
      title: '作业.pdf',
      format: 'pdf',
      revision: null,
      freshness: { kind: 'realtime' },
      text: 'cd',
      totalCharacters: 6,
      nextOffset: 4,
      readable: true,
      pages: 2,
    });
    expect(withResourceFile).toHaveBeenCalledWith(ref, expect.any(Function));
  });

  it('解析失败走 parseFailure 形态，非文档类型提示导入', async () => {
    vi.mocked(mailAttachment).mockReturnValue({
      row: {} as ReturnType<typeof mailAttachment>['row'],
      attachment: { filename: '照片.png', size: 2048, part: '1.2' },
      part: '1.2',
    });
    vi.mocked(parseDocumentFile).mockRejectedValue(
      new Error('不支持的文档类型：仅支持 PDF、DOCX、PPTX'),
    );
    await expect(readResourceTool.execute({ ref })).resolves.toMatchObject({
      title: '照片.png',
      format: 'unsupported',
      readable: false,
      text: undefined,
      nextOffset: null,
      parseError: '不支持的文档类型：仅支持 PDF、DOCX、PPTX',
      hint: expect.stringContaining('copy_file_to_project'),
    });
  });

  it('附件不存在映射为 NOT_FOUND', async () => {
    vi.mocked(mailAttachment).mockImplementation(() => {
      throw new Error('附件不存在，请先同步邮件');
    });
    await expect(readResourceTool.execute({ ref })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('read_resource: 图片输出', () => {
  it('workspace 图片文件以 images 数组附图（形状与 PDF pages 一致）', async () => {
    vi.mocked(readWorkspaceEntry).mockResolvedValue({
      title: '图表.png',
      format: 'image',
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
    });
    await expect(
      readResourceTool.execute({ ref: { type: 'workspace', id: noteId } }),
    ).resolves.toEqual({
      ref: { type: 'workspace', id: noteId },
      title: '图表.png',
      format: 'image',
      revision: null,
      freshness: { kind: 'cached' },
      pageImages: [{ page: 1 }],
      images: [{ page: 1, dataUrl: 'data:image/png;base64,AQID' }],
      note: '图片已作为图片消息附后。',
    });
  });

  it('canvas 图片文件同样直接附图', async () => {
    vi.mocked(readCanvasSource).mockResolvedValue({
      title: '板书.jpg',
      format: 'image',
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/jpeg',
      updatedAt: '2026-09-01T00:00:00Z',
    });
    await expect(
      readResourceTool.execute({ ref: { type: 'canvas', id: 'file:1' } }),
    ).resolves.toMatchObject({
      format: 'image',
      images: [{ page: 1, dataUrl: 'data:image/jpeg;base64,AQID' }],
    });
  });
});

describe('read_resource: mail 契约', () => {
  it('按需拉取标 realtime+邮件时间，附件列表带 attachment ref', async () => {
    vi.mocked(readMailMessage).mockResolvedValue({
      id: 9,
      uid: 42,
      subject: '通知',
      sender: { name: '教务', address: 'jwc@sjtu.edu.cn' },
      date: '2026-09-01T00:00:00Z',
      seen: false,
      flagged: false,
      hasAttachments: true,
      snippet: null,
      size: 100,
      to: [],
      cc: [],
      bodyText: 'abcdef',
      bodyHtml: null,
      attachments: [{ filename: '附.pdf', size: 10, part: '2' }],
    });
    await expect(
      readResourceTool.execute({ ref: { type: 'mail', id: 9 }, offset: 1, limit: 2 }),
    ).resolves.toMatchObject({
      format: 'text',
      revision: null,
      freshness: { kind: 'realtime', syncedAt: '2026-09-01T00:00:00Z' },
      text: 'bc',
      nextOffset: 3,
      attachments: [
        { name: '附.pdf', size: 10, ref: { type: 'attachment', messageId: 9, part: '2' } },
      ],
    });
  });

  it('邮件不存在映射为 NOT_FOUND', async () => {
    vi.mocked(readMailMessage).mockRejectedValue(new Error('邮件不存在'));
    await expect(readResourceTool.execute({ ref: { type: 'mail', id: 9 } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('缺正文且邮箱未配置映射为 NOT_CONFIGURED', async () => {
    vi.mocked(readMailMessage).mockRejectedValue(new Error('邮箱未配置'));
    await expect(readResourceTool.execute({ ref: { type: 'mail', id: 9 } })).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });
});
