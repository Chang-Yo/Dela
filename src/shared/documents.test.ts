import { describe, expect, it } from 'vitest';
import { documentFormatOf, isTextDocumentName } from './documents';

describe('文档格式判定', () => {
  it.each([
    '.env',
    '.env.example',
    '.env.local',
    '.gitignore',
    'Makefile',
    'Dockerfile',
    'LICENSE',
    'README',
  ])('%s 按文本处理', (name) => {
    expect(isTextDocumentName(name)).toBe(true);
    expect(documentFormatOf(name)).toBe('text');
  });

  it('点文件路径按文件名判断', () => {
    expect(documentFormatOf('/home/u/proj/.env.example')).toBe('text');
  });

  it('已有格式不受文本扩展名规则影响', () => {
    expect(documentFormatOf('README.md')).toBe('markdown');
    expect(documentFormatOf('logo.png')).toBe('image');
    expect(documentFormatOf('manual.pdf')).toBe('pdf');
    expect(documentFormatOf('report.docx')).toBe('docx');
  });

  it('未知扩展仍为不支持', () => {
    expect(documentFormatOf('archive.bin')).toBe('unsupported');
  });
});
