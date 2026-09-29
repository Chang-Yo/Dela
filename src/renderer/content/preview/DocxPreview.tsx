import { renderAsync } from 'docx-preview';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { usePinchZoom } from './use-pinch-zoom';

// 缩放范围与步进：与 PdfReader 的 10% 步进一致。
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

/** Word 文档只读预览：经受限资源协议取回字节，docx-preview 渲染为分页页面。 */
export function DocxPreview({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  usePinchZoom(scroller, setZoom, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!host.current) return;
        host.current.replaceChildren();
        // useBase64URL：图片/字体以 data: URL 内联（CSP 的 img-src/font-src 均已放行 data:）。
        // 库默认的 blob 路径实测不产出 img src，且 font-src 未放行 blob:。
        // renderAltChunks:false：altChunk 默认渲染为无 sandbox 的 srcdoc iframe，直接关闭。
        await renderAsync(await response.arrayBuffer(), host.current, undefined, {
          useBase64URL: true,
          renderAltChunks: false,
        });
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [url, attempt]);
  const step = (direction: number) =>
    setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + direction * ZOOM_STEP)));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-center-safe gap-2 overflow-x-auto border-b px-3 py-1 text-xs">
        <Button size="icon-sm" variant="ghost" aria-label="缩小文档" onClick={() => step(-1)}>
          <Minus />
        </Button>
        <button title="重置缩放" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <Button size="icon-sm" variant="ghost" aria-label="放大文档" onClick={() => step(1)}>
          <Plus />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          className="absolute inset-0 overflow-auto overscroll-contain bg-muted [overflow-anchor:none] [scrollbar-gutter:stable]"
        >
          <div ref={host} style={{ zoom }} className="docx-preview-host min-h-full" />
        </div>
        {error && (
          <p
            role="alert"
            className="absolute inset-x-0 top-0 break-words bg-background p-3 text-sm text-destructive"
          >
            文档打开失败：{error}
            <button className="ml-2 underline" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          </p>
        )}
        {loading && !error && (
          <p role="status" className="absolute inset-x-0 top-0 p-3 text-sm text-muted-foreground">
            正在加载文档…
          </p>
        )}
      </div>
    </div>
  );
}
