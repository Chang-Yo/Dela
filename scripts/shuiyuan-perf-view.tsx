import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentLoaderProvider, PreviewTab } from '../src/modules/preview/view';
import '../src/renderer/styles/globals.css';
import type { DocumentContent } from '../src/modules/workspace/contract';
import { ShuiyuanSourceDoc } from '../src/sjtu/shuiyuan/view/SourceRefCard';

const bridge = (
  window as unknown as {
    benchmark: { read(): Promise<DocumentContent>; report(value: unknown): void };
  }
).benchmark;
const start = performance.now();
const longTasks: number[] = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) longTasks.push(entry.duration);
}).observe({ type: 'longtask', buffered: true });
let previous = start;
let maxFrameGap = 0;
function frame(now: number) {
  maxFrameGap = Math.max(maxFrameGap, now - previous);
  previous = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
let firstBodyMs: number | null = null;
window.addEventListener('message', (event) => {
  if (
    event.data?.source === 'dela-frame-height' &&
    event.data.height > 48 &&
    firstBodyMs === null
  ) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (firstBodyMs === null) firstBodyMs = performance.now() - start;
      }),
    );
  }
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <ContentLoaderProvider
      loader={{
        loadDocument: async () => ({
          content: await bridge.read(),
          source: { id: 'shuiyuan-topic:42', document: ShuiyuanSourceDoc },
        }),
        openLink() {},
        navigate: () => true,
      }}
    >
      <PreviewTab tabId="preview:benchmark" groupId="benchmark" />
    </ContentLoaderProvider>
  </QueryClientProvider>,
);
setTimeout(() => {
  bridge.report({
    firstBodyMs,
    elapsedMs: performance.now() - start,
    maxFrameGap,
    longTaskCount: longTasks.length,
    longTaskTotalMs: longTasks.reduce((a, b) => a + b, 0),
    longestTaskMs: Math.max(0, ...longTasks),
    heapMiB:
      (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize /
      1048576,
    iframeCount: document.querySelectorAll('iframe').length,
  });
}, 8000);
