// @vitest-environment jsdom
// 设置 › 工作区：拼写检查开关写入 noteSpellcheck，并同步给已挂载编辑器的镜像。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WorkspacePrefs } from '../../../../shared/api';
import { useNoteSpellcheck } from '../../../content/note/note-spellcheck';
import { WorkspaceSection } from './WorkspaceSection';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useNoteSpellcheck.setState({ spellcheck: false });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

it('persists the spellcheck switch and mirrors it to the note editors', async () => {
  const stored: WorkspacePrefs = {
    restoreLastProject: true,
    defaultNoteEditMode: 'rich',
    noteSpellcheck: false,
  };
  const setWorkspacePrefs = vi.fn(async (patch: Partial<WorkspacePrefs>) => {
    Object.assign(stored, patch);
    return { ...stored };
  });
  window.dela = {
    settings: {
      getWorkspacePrefs: async () => ({ ...stored }),
      setWorkspacePrefs,
    },
  } as unknown as DelaApi;

  await act(async () => root.render(<WorkspaceSection />));
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="笔记拼写检查"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');

  await act(async () => toggle.click());
  expect(setWorkspacePrefs).toHaveBeenCalledWith({ noteSpellcheck: true });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(useNoteSpellcheck.getState().spellcheck).toBe(true);

  await act(async () => toggle.click());
  expect(setWorkspacePrefs).toHaveBeenLastCalledWith({ noteSpellcheck: false });
  expect(useNoteSpellcheck.getState().spellcheck).toBe(false);
});
