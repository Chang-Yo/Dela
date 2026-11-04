import { createRoot } from 'react-dom/client';
import { PreviewTab } from '../src/renderer/content/preview/PreviewTab';
import { ContentLoaderProvider } from '../src/renderer/content/preview/loader';
import '../src/renderer/styles/globals.css';
import type { DocumentContent } from '../src/shared/api';

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
  <ContentLoaderProvider
    loader={{
      loadDocument: async () => ({ content: await bridge.read(), shuiyuanTopicId: 42 }),
      openLink() {},
      openShuiyuanTopic() {},
    }}
  >
    <PreviewTab tabId="preview:benchmark" groupId="benchmark" />
  </ContentLoaderProvider>,
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
