import { useEffect, useRef, useState } from 'react';
import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
} from 'pdfjs-dist';
import { EventBus, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Minus, MoveHorizontal, Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { errorText } from '../../workspace/store';
import 'pdfjs-dist/web/pdf_viewer.css';

declare const __PDF_ASSET_DIR__: string;
GlobalWorkerOptions.workerSrc = workerUrl;
// Bound each page bitmap to 16 MiB; the official viewer owns its LRU and render queue.
const MAX_PIXELS = 4 * 1024 * 1024;
// Match the generic PDF.js viewer's default drawing delay.
const DRAWING_DELAY = 400;

export function PdfReader({
  url,
  scroll,
  onScroll,
}: {
  url: string;
  scroll: number;
  onScroll?: (top: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const viewer = useRef<PDFViewer | null>(null);
  const position = useRef(scroll);
  const callbacks = useRef({ onScroll });
  callbacks.current = { onScroll };
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let disposed = false;
    let initialized = false;
    const element = host.current!;
    const controller = new AbortController();
    const lifecycle = new AbortController();
    const eventBus = new EventBus();
    const options = {
      container: element,
      viewer: pages.current!,
      eventBus,
      removePageBorders: true,
      annotationMode: AnnotationMode.DISABLE,
      enableAutoLinking: false,
      maxCanvasPixels: MAX_PIXELS,
      // Use the full-page fallback at the pixel cap, without a second detail bitmap.
      enableDetailCanvas: false,
      abortSignal: lifecycle.signal,
    };
    const instance = new PDFViewer(options);
    viewer.current = instance;
    let task: PDFDocumentLoadingTask | undefined;
    const fail = (error: unknown) => {
      if (disposed || controller.signal.aborted) return;
      setError(errorText(error));
      initialized = false;
      setPageCount(0);
      controller.abort();
      instance.setDocument(null!);
      void task?.destroy();
    };
    const savePosition = () => {
      if (!initialized || disposed) return;
      // Persist page + relative offset using actual page geometry, not equal-height slots.
      const index = instance.currentPageNumber - 1;
      const page = instance.getPageView(index).div;
      if (!page.clientHeight) return;
      position.current = Math.max(
        0,
        index +
          Math.max(0, Math.min(0.999, (element.scrollTop - page.offsetTop) / page.clientHeight)),
      );
      callbacks.current.onScroll?.(position.current);
    };
    eventBus.on('pagesinit', () => {
      if (disposed) return;
      instance.currentScaleValue = 'page-width';
      const index = Math.min(instance.pagesCount - 1, Math.floor(position.current));
      instance.currentPageNumber = index + 1;
      const page = instance.getPageView(index).div;
      element.scrollTop = page.offsetTop + (position.current % 1) * page.clientHeight;
      initialized = true;
      setPageCount(instance.pagesCount);
      instance.update();
    });
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      setCurrent(pageNumber);
      setPageInput(String(pageNumber));
    });
    eventBus.on('scalechanging', ({ scale }: { scale: number }) => setZoom(scale));
    eventBus.on('updateviewarea', savePosition);
    eventBus.on('pagerendered', ({ error }: { error?: unknown }) => {
      if (error) fail(error);
    });
    const resize = new ResizeObserver(() => {
      if (!initialized) return;
      if (instance.currentScaleValue === 'page-width') instance.currentScaleValue = 'page-width';
      instance.update();
    });
    resize.observe(element);
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !initialized) return;
      event.preventDefault();
      // Same pixel-mode pinch conversion as Mozilla's generic viewer.
      instance.update();
      const bounds = element.getBoundingClientRect();
      instance.updateScale({
        ...(event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
          ? { scaleFactor: Math.exp(-event.deltaY / 100) }
          : { steps: -Math.sign(event.deltaY) }),
        drawingDelay: DRAWING_DELAY,
        // PDFViewer uses offset-parent coordinates for its zoom origin.
        origin: [
          event.clientX - bounds.left + element.offsetLeft,
          event.clientY - bounds.top + element.offsetTop,
        ],
      });
    };
    element.addEventListener('wheel', wheel, { passive: false, signal: lifecycle.signal });
    const assetBase = new URL(
      import.meta.env.DEV ? '/@fs/' + __PDF_ASSET_DIR__ + '/' : './pdfjs/',
      document.baseURI,
    ).href;
    // PDF.js only enables automatic range loading for http(s). Our scoped local
    // protocol therefore supplies its explicit range transport through fetch.
    void (async () => {
      const initial = await fetch(url, {
        headers: { Range: 'bytes=0-65535' },
        signal: controller.signal,
      });
      const length = Number(initial.headers.get('content-range')?.split('/')[1]);
      if (initial.status !== 206 || !Number.isSafeInteger(length) || length <= 0)
        throw new Error('无法分段读取 PDF');
      const bytes = new Uint8Array(await initial.arrayBuffer());
      if (disposed) return;
      const range = new PDFDataRangeTransport(length, bytes, true);
      range.requestDataRange = (begin, end) => {
        void fetch(url, {
          headers: { Range: `bytes=${begin}-${end - 1}` },
          signal: controller.signal,
        })
          .then(async (response) => {
            if (response.status !== 206) throw new Error('PDF 分段读取失败');
            const data = new Uint8Array(await response.arrayBuffer());
            if (data.length !== end - begin) throw new Error('PDF 分段数据不完整');
            if (!disposed) range.onDataRange(begin, data);
          })
          .catch(fail);
      };
      range.abort = () => controller.abort();
      task = getDocument({
        range,
        cMapUrl: assetBase + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: assetBase + 'standard_fonts/',
        wasmUrl: assetBase + 'wasm/',
        disableAutoFetch: true,
        disableStream: true,
        canvasMaxAreaInBytes: MAX_PIXELS * 4,
      });
      const doc = await task.promise;
      if (disposed) return;
      instance.setDocument(doc);
    })().catch(fail);
    return () => {
      disposed = true;
      resize.disconnect();
      lifecycle.abort();
      controller.abort();
      instance.setDocument(null!);
      viewer.current = null;
      void task?.destroy();
    };
  }, [url, attempt]);
  const go = (page: number) => {
    if (viewer.current && Number.isFinite(page) && pageCount)
      viewer.current.currentPageNumber = Math.min(pageCount, Math.max(1, Math.trunc(page)));
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* safe 居中：工具组窄于容器时居中，放不下时对齐起点并横向滚动（居中溢出会把两侧按钮裁成不可达）。 */}
      <div className="flex shrink-0 items-center justify-center-safe gap-2 overflow-x-auto border-b px-3 py-1 text-xs">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="上一页"
          disabled={!pageCount || current === 1}
          onClick={() => go(current - 1)}
        >
          <ChevronLeft />
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(Number(pageInput));
          }}
        >
          <input
            aria-label="PDF 页码"
            className="w-12 rounded border border-line bg-surface px-1 text-center"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
          />
          <span className="ml-2 text-ink-3">/ {pageCount || '…'}</span>
        </form>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="下一页"
          disabled={!pageCount || current === pageCount}
          onClick={() => go(current + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="缩小 PDF"
          disabled={!pageCount}
          onClick={() => viewer.current?.decreaseScale({ drawingDelay: DRAWING_DELAY })}
        >
          <Minus />
        </Button>
        {/* 与 Docx/Sheet 预览统一：点击百分比重置为 100%，适合宽度走独立按钮。 */}
        <button
          title="重置缩放到 100%"
          aria-label="重置缩放到 100%"
          disabled={!pageCount}
          className="rounded-control px-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bui-accent"
          onClick={() => {
            if (viewer.current) viewer.current.currentScaleValue = '1';
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="适合宽度"
          aria-label="适合宽度"
          disabled={!pageCount}
          onClick={() => {
            if (viewer.current) viewer.current.currentScaleValue = 'page-width';
          }}
        >
          <MoveHorizontal />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="放大 PDF"
          disabled={!pageCount}
          onClick={() => viewer.current?.increaseScale({ drawingDelay: DRAWING_DELAY })}
        >
          <Plus />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={host}
          className="absolute inset-0 overflow-auto overscroll-contain bg-inset [overflow-anchor:none] [scrollbar-gutter:stable]"
        >
          <div ref={pages} className="pdfViewer dela-pdf-pages" />
        </div>
        {error && (
          <p
            role="alert"
            className="absolute inset-x-0 top-0 break-words bg-surface p-3 text-13 text-red"
          >
            PDF 打开失败：{error}
            <button
              className="ml-2 underline"
              onClick={() => {
                setPageCount(0);
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              重试
            </button>
          </p>
        )}
        {!pageCount && !error && (
          <p role="status" className="absolute inset-x-0 top-0 p-3 text-13 text-ink-3">
            正在加载 PDF…
          </p>
        )}
      </div>
    </div>
  );
}
