import { describe, expect, it } from 'vitest';
import { SNIFF_BYTES, extensionOf, fileFormatOf, isTextContent } from './files';

const utf8 = (text: string) => new TextEncoder().encode(text);

describe('fileFormatOf', () => {
  it('专用查看器只看扩展名；其余按内容判定，不依赖扩展名白名单', () => {
    expect(fileFormatOf('a/README.MD', Uint8Array.of(0))).toBe('markdown');
    expect(fileFormatOf('课件.pdf', utf8('x'))).toBe('pdf');
    expect(fileFormatOf('logo.svg', utf8('<svg/>'))).toBe('image');
    for (const name of ['.env', '.gitignore', 'Makefile', 'run.log', 'main.zig', 'x.unknown'])
      expect(fileFormatOf(name, utf8('content\n'))).toBe('text');
    expect(fileFormatOf('core', Uint8Array.of(0x7f, 0x45, 0x4c, 0x46, 0, 0))).toBe('binary');
    expect(fileFormatOf('empty', new Uint8Array())).toBe('text');
  });

  it('点开头的文件名没有扩展名', () => {
    expect(extensionOf('.env')).toBe('');
    expect(extensionOf('C:\\proj\\.config\\a.Json')).toBe('.json');
    expect(extensionOf('/home/u/.bashrc')).toBe('');
  });
});

describe('isTextContent', () => {
  it('非 UTF-8 文本（GBK）按二进制处理，防止按 UTF-8 写回损坏', () => {
    expect(isTextContent(Uint8Array.of(0xd6, 0xd0, 0xce, 0xc4))).toBe(false);
    expect(isTextContent(utf8('中文'))).toBe(true);
  });

  it('NUL 只在嗅探窗口内检查', () => {
    const late = new Uint8Array(SNIFF_BYTES + 1).fill(0x61);
    late[SNIFF_BYTES] = 0;
    expect(isTextContent(late)).toBe(true);
  });

  it('截断的头部末尾切开多字节字符时仍判为文本；完整内容里的残缺字符不行', () => {
    const cut = utf8('ab中').subarray(0, 4);
    expect(isTextContent(cut, true)).toBe(true);
    expect(isTextContent(cut, false)).toBe(false);
  });
});
