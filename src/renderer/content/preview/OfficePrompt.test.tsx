// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, OfficeExportInfo } from '../../../shared/api';
import { OfficeExportBanner, OfficePromptCard } from './OfficePrompt';
import { useToastStore } from '../../app/toasts';

const officeRef = { type: 'canvas' as const, id: 'file:1' };
const exported: OfficeExportInfo = {
  title: '课件.pdf',
  previewUrl: 'dela-resource://workspace/fixture',
  stale: false,
};
const convert = vi.fn(async () => {});
const refresh = vi.fn();
const openResourceFile = vi.fn(async () => {});
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.dela = {
    platform: 'darwin',
    workspace: { exportOfficePdf: convert, openResourceFile },
  } as unknown as DelaApi;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useToastStore.setState({ toasts: [] });
  delete window.dela;
  vi.unstubAllGlobals();
});

it('Mac 未导出的 PPTX 只提供系统默认应用打开，不提供转换按钮', async () => {
  await act(async () =>
    root.render(<OfficePromptCard title="课件.pptx" officeRef={officeRef} onExported={refresh} />),
  );
  expect(container.querySelectorAll('button')).toHaveLength(1);
  expect(convert).not.toHaveBeenCalled();
});

it('Mac 已有 PDF 未过期时不显示重新导出入口', async () => {
  await act(async () =>
    root.render(
      <OfficeExportBanner exported={exported} officeRef={officeRef} onExported={refresh} />,
    ),
  );
  expect(container.textContent).toBe('');
  expect(convert).not.toHaveBeenCalled();
});

it('Mac 已有 PDF 过期时仍提示内容过期，但不提供重新导出', async () => {
  await act(async () =>
    root.render(
      <OfficeExportBanner
        exported={{ ...exported, stale: true }}
        officeRef={officeRef}
        onExported={refresh}
      />,
    ),
  );
  const status = container.querySelector('[role="status"]');
  expect(status).not.toBeNull();
  expect(status?.textContent).toBeTruthy();
  expect(container.querySelector('button')).toBeNull();
});

it('Windows 首次导出仍调用原有 API 并刷新预览', async () => {
  window.dela = { ...window.dela!, platform: 'win32' };
  await act(async () =>
    root.render(<OfficePromptCard title="课件.pptx" officeRef={officeRef} onExported={refresh} />),
  );
  await act(async () => container.querySelector('button')!.click());
  expect(convert).toHaveBeenCalledWith(officeRef);
  expect(refresh).toHaveBeenCalledOnce();
});

it.each([false, true])('Windows 已有 PDF（过期=%s）仍可重新导出', async (stale) => {
  window.dela = { ...window.dela!, platform: 'win32' };
  await act(async () =>
    root.render(
      <OfficeExportBanner
        exported={{ ...exported, stale }}
        officeRef={officeRef}
        onExported={refresh}
      />,
    ),
  );
  await act(async () => container.querySelector('button')!.click());
  expect(convert).toHaveBeenCalledWith(officeRef);
  expect(refresh).toHaveBeenCalledOnce();
});

it('Windows 确认卡片并排提供 PDF 转换与外部打开', async () => {
  window.dela = { ...window.dela!, platform: 'win32' };
  await act(async () =>
    root.render(<OfficePromptCard title="课件.pptx" officeRef={officeRef} onExported={refresh} />),
  );
  expect(container.querySelectorAll('button')).toHaveLength(2);
});

it.each(['canvas', 'workspace'] as const)(
  'Mac 在外部打开 %s 原文件，复用共享 API',
  async (type) => {
    const ref = { type, id: '课件.pptx' };
    await act(async () =>
      root.render(<OfficePromptCard title="课件.pptx" officeRef={ref} onExported={refresh} />),
    );
    await act(async () => container.querySelector('button')!.click());
    expect(openResourceFile).toHaveBeenCalledWith(ref);
    expect(convert).not.toHaveBeenCalled();
  },
);

it('外部打开失败经 toast 提示', async () => {
  openResourceFile.mockRejectedValueOnce(new Error('没有关联的应用'));
  await act(async () =>
    root.render(<OfficePromptCard title="课件.pptx" officeRef={officeRef} onExported={refresh} />),
  );
  await act(async () => container.querySelector('button')!.click());
  expect(openResourceFile).toHaveBeenCalledWith(officeRef);
  expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
    variant: 'error',
    description: '没有关联的应用',
  });
});
