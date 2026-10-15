// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useToastStore } from '../../app/toasts';
import { OfficePromptCard } from './OfficePrompt';

let host: HTMLDivElement;
let root: Root;
const openResourceFile = vi.fn(() => Promise.resolve());

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('dela', { workspace: { openResourceFile } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

const canvasRef = { type: 'canvas', id: 'file:7' } as const;

function render() {
  act(() => {
    root.render(
      <OfficePromptCard title="lec1.pptx" officeRef={canvasRef} onExported={undefined} />,
    );
  });
  return [...host.querySelectorAll('button')];
}

it('确认卡片并排提供「导出为 PDF 预览」与「在外部打开」', () => {
  const buttons = render().map((button) => button.textContent);
  expect(buttons.some((text) => text?.includes('导出为 PDF 预览'))).toBe(true);
  expect(buttons.some((text) => text?.includes('在外部打开'))).toBe(true);
});

it('点「在外部打开」把资源引用交给主进程；失败经 toast 提示', async () => {
  openResourceFile.mockRejectedValueOnce(new Error('没有关联的应用'));
  const open = render().find((button) => button.textContent?.includes('在外部打开'))!;
  await act(async () => {
    open.click();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(openResourceFile).toHaveBeenCalledWith(canvasRef);
  expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
    variant: 'error',
    title: '打开失败',
  });
});
