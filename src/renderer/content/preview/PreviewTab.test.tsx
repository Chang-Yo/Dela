// @vitest-environment jsdom
// 不支持内嵌预览的 Canvas 文件要在预览页直接提供单文件下载。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TabId } from '../../../shared/layout';
import { ContentLoaderProvider, type ContentLoader, type LoadedDocument } from './loader';
import { PreviewTab } from './PreviewTab';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function loaderOf(doc: LoadedDocument): ContentLoader {
  return {
    loadDocument: async () => doc,
    openLink: vi.fn(),
    openShuiyuanTopic: vi.fn(),
  };
}

async function render(loader: ContentLoader) {
  await act(async () =>
    root.render(
      <ContentLoaderProvider loader={loader}>
        <PreviewTab groupId="g" tabId={'preview:source:file:42' as TabId} />
      </ContentLoaderProvider>,
    ),
  );
}

function downloadButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('下载文件'),
  );
}

it('offers a single-file download when a Canvas file cannot be previewed', async () => {
  const download = vi.fn();
  await render(
    loaderOf({
      content: { title: '课件.zip', format: 'binary', mime: 'application/zip' },
      download,
    }),
  );
  expect(container.textContent).toContain('无法内嵌预览');
  const button = downloadButton();
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(download).toHaveBeenCalledOnce();
});

it('does not offer download when the document has no original file', async () => {
  await render(loaderOf({ content: { title: '本地文件.bin', format: 'binary' } }));
  expect(container.textContent).toContain('无法内嵌预览');
  expect(downloadButton()).toBeUndefined();
});
