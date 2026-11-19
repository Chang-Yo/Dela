import { describe, expect, it } from 'vitest';
import { chatFileKind, chatImageToken, parseChatBlocks } from '../protocol/chat-input';

const id = '01234567-89ab-cdef-0123-456789abcdef';

describe('parseChatBlocks', () => {
  it('按出现顺序拆分文本与图片', () => {
    const text = `先看这段\n${chatImageToken(id, '截图.png')}\n再看这段`;
    expect(parseChatBlocks(text)).toEqual([
      { type: 'text', text: '先看这段\n' },
      { type: 'image', id, name: '截图.png' },
      { type: 'text', text: '\n再看这段' },
    ]);
  });

  it('普通 Markdown 图片链接不被当作内联图片', () => {
    expect(parseChatBlocks('![外链](https://example.com/a.png)')).toEqual([
      { type: 'text', text: '![外链](https://example.com/a.png)' },
    ]);
    expect(parseChatBlocks('![损坏](dela-img:not-a-uuid)')).toEqual([
      { type: 'text', text: '![损坏](dela-img:not-a-uuid)' },
    ]);
  });
});

describe('chatFileKind', () => {
  it('位图走内联图片，PDF/Office 与二进制交给文档 skill，其余文本按内容判定', () => {
    const text = new TextEncoder().encode('hello');
    const binary = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0]);
    expect(chatFileKind('照片.JPG', binary)).toBe('image');
    expect(chatFileKind('笔记.md', text)).toBe('text');
    expect(chatFileKind('脚本.ts', text)).toBe('text');
    expect(chatFileKind('README', text)).toBe('text');
    expect(chatFileKind('.env', text)).toBe('text');
    expect(chatFileKind('图标.svg', text)).toBe('text');
    expect(chatFileKind('课件.pdf', text)).toBe('document');
    expect(chatFileKind('汇报.pptx.pptx', binary)).toBe('document');
    expect(chatFileKind('压缩包.zip', binary)).toBe('document');
  });
});
