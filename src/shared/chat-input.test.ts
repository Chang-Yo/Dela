import { describe, expect, it } from 'vitest';
import {
  chatFileKind,
  chatImageToken,
  hasChatImages,
  parseChatBlocks,
  stripChatImageTokens,
} from './chat-input';

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

  it('纯文本与图片开头都能解析', () => {
    expect(parseChatBlocks('只有文字')).toEqual([{ type: 'text', text: '只有文字' }]);
    expect(parseChatBlocks(chatImageToken(id, 'a.png'))).toEqual([
      { type: 'image', id, name: 'a.png' },
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

  it('strip 与 hasChatImages 只处理内联 token', () => {
    const text = `说明 ${chatImageToken(id, '[怪]名.png')} 结束`;
    expect(stripChatImageTokens(text)).toBe('说明  结束');
    expect(hasChatImages(text)).toBe(true);
    expect(hasChatImages('![x](https://e.com/a.png)')).toBe(false);
  });
});

describe('chatFileKind', () => {
  it('识别图片与文本，其余文件交给文档 skill 判断', () => {
    expect(chatFileKind('照片.JPG')).toBe('image');
    expect(chatFileKind('笔记.md')).toBe('text');
    expect(chatFileKind('脚本.ts')).toBe('text');
    expect(chatFileKind('README')).toBe('document');
    expect(chatFileKind('课件.pdf')).toBe('document');
    expect(chatFileKind('汇报.pptx.pptx')).toBe('document');
    expect(chatFileKind('压缩包.zip')).toBe('document');
  });
});
