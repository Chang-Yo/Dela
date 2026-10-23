// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { previewBranchOf } from './PreviewTab';
import { parsePreviewTabId, type PreviewTabTarget } from './tab-id';
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
  it('按格式分流；无法当文本打开的内容走 binary 提示', () => {
    expect(previewBranchOf(docOf('text', { watchesDisk: true }))).toBe('text');
    expect(previewBranchOf(docOf('markdown'))).toBe('markdown');
    expect(previewBranchOf(docOf('binary'))).toBe('binary');
  });

  it('水源来源优先于格式分流', () => {
    expect(previewBranchOf(docOf('html', { shuiyuanTopicId: 456 }))).toBe('shuiyuan');
    expect(previewBranchOf(docOf('text', { shuiyuanTopicId: 456, watchesDisk: true }))).toBe(
      'shuiyuan',
    );
  });
});
