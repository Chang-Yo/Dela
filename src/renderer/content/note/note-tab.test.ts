// @vitest-environment jsdom
// note:{entryId} 标签键解析（workbench TabId 契约，shared/layout.ts）。
import { describe, expect, it } from 'vitest';
import { parseNoteTabId } from './NoteTab';

describe('parseNoteTabId', () => {
  it('解析 note:{entryId} 载荷', () => {
    expect(parseNoteTabId('note:00000000-0000-4000-8000-000000000002')).toBe(
      '00000000-0000-4000-8000-000000000002',
    );
  });

  it('空载荷返回 null', () => {
    expect(parseNoteTabId('note:')).toBeNull();
  });

  it('其他标签 kind 返回 null', () => {
    expect(parseNoteTabId('preview:00000000-0000-4000-8000-000000000002')).toBeNull();
    expect(parseNoteTabId('preview:source:file:123')).toBeNull();
    expect(parseNoteTabId('chat:abc')).toBeNull();
    expect(parseNoteTabId('review:abc')).toBeNull();
  });
});
