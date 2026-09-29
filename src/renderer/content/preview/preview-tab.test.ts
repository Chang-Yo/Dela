// @vitest-environment jsdom
// preview 标签键解析与格式分流决策（原 SourceDetail 分流 + ProjectDocument 只读分支）。
import { describe, expect, it } from 'vitest';
import { parsePreviewTabId, previewBranchOf, type PreviewTabTarget } from './PreviewTab';
import type { LoadedDocument } from './loader';

describe('parsePreviewTabId', () => {
  it('工作区条目：preview:{entryId}', () => {
    expect(
      parsePreviewTabId('preview:00000000-0000-4000-8000-000000000002'),
    ).toEqual<PreviewTabTarget>({ entryId: '00000000-0000-4000-8000-000000000002' });
  });

  it('@ 引用型资料：preview:source:{原 documentKey} 保留原 key 全文', () => {
    expect(parsePreviewTabId('preview:source:file:123')).toEqual<PreviewTabTarget>({
      sourceId: 'file:123',
    });
    expect(parsePreviewTabId('preview:source:shuiyuan-topic:456')).toEqual<PreviewTabTarget>({
      sourceId: 'shuiyuan-topic:456',
    });
  });

  it('空载荷返回 null', () => {
    expect(parsePreviewTabId('preview:')).toBeNull();
    expect(parsePreviewTabId('preview:source:')).toBeNull();
  });

  it('其他标签 kind 返回 null', () => {
    expect(parsePreviewTabId('note:00000000-0000-4000-8000-000000000002')).toBeNull();
    expect(parsePreviewTabId('chat:abc')).toBeNull();
    expect(parsePreviewTabId('review:abc')).toBeNull();
  });
});

function docOf(format: LoadedDocument['content']['format'], extra?: Partial<LoadedDocument>) {
  return { content: { title: 't', format }, ...extra };
}

describe('previewBranchOf', () => {
  it('按 DocumentContent.format 分流到各预览器', () => {
    expect(previewBranchOf(docOf('pdf'))).toBe('pdf');
    expect(previewBranchOf(docOf('image'))).toBe('image');
    expect(previewBranchOf(docOf('docx'))).toBe('docx');
    expect(previewBranchOf(docOf('xlsx'))).toBe('xlsx');
    expect(previewBranchOf(docOf('pptx'))).toBe('pptx');
    expect(previewBranchOf(docOf('html'))).toBe('html');
    expect(previewBranchOf(docOf('markdown'))).toBe('markdown');
    expect(previewBranchOf(docOf('unsupported'))).toBe('unsupported');
  });

  it('文本文件按是否本地磁盘文件区分：语法高亮查看器或纯文本', () => {
    expect(previewBranchOf(docOf('text', { watchesDisk: true }))).toBe('code');
    expect(previewBranchOf(docOf('text', { watchesDisk: false }))).toBe('text');
    expect(previewBranchOf(docOf('text'))).toBe('text');
  });

  it('水源来源优先于格式分流', () => {
    expect(previewBranchOf(docOf('html', { shuiyuanTopicId: 456 }))).toBe('shuiyuan');
    expect(previewBranchOf(docOf('text', { shuiyuanTopicId: 456, watchesDisk: true }))).toBe(
      'shuiyuan',
    );
  });
});
