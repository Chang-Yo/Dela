import { Minus, Plus } from 'lucide-react';
import { renderDocx } from 'office-lite/docx';
import { renderPptx } from 'office-lite/pptx';
import { renderXlsx, type XlsxInstance } from 'office-lite/xlsx';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/button';
import { ErrorText } from '../../../ui/error-text';
import { InlineButton } from '../../../ui/inline-button';
import { cn } from '../../../ui/lib/cn';
import { errorMessage } from '../../../core/protocol/contract';
import { pinchZoomRef } from './use-pinch-zoom';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

const kindNoun: Record<OfficeKind, string> = { docx: '文档', xlsx: '表格', pptx: '演示文稿' };

export function OfficePreview({ url, kind }: { url: string; kind: OfficeKind }) {
  const host = useRef<HTMLDivElement>(null);
  const workbook = useRef<XlsxInstance | null>(null);
  const [attempt, setAttempt] = useState(0);
  const run = `${attempt}:${url}`;
  const [result, setResult] = useState<{ run: string; error: string; sheets: string[] } | null>(
    null,
  );
  const loading = result?.run !== run;
  const error = loading ? '' : result.error;
  const sheets = loading ? [] : result.sheets;
  const [activeSheet, setActiveSheet] = useState(0);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const container = host.current!;
    const controller = new AbortController();
    const { signal } = controller;
    let instance: { destroy(): void } | null = null;
    void (async () => {
      try {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        let sheetNames: string[] = [];
        if (kind === 'xlsx') {
          const book = await renderXlsx(container, buffer, { signal });
          workbook.current = book;
          sheetNames = book.sheetNames;
          instance = book;
        } else {
          instance = await (kind === 'docx' ? renderDocx : renderPptx)(container, buffer, {
            signal,
          });
        }
        if (signal.aborted) return instance.destroy();
        setActiveSheet(0);
        setResult({ run, error: '', sheets: sheetNames });
      } catch (cause) {
        if (!signal.aborted) setResult({ run, error: errorMessage(cause), sheets: [] });
      }
    })();
    return () => {
      controller.abort();
      instance?.destroy();
      workbook.current = null;
    };
  }, [run, url, kind]);
  const step = (direction: number) =>
    setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + direction * ZOOM_STEP)));
  const selectSheet = (index: number) => {
    workbook.current?.setSheet(index);
    setActiveSheet(index);
  };
  const noun = kindNoun[kind];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-center-safe gap-2 overflow-x-auto border-b px-3 py-1 text-xs">
        <Button size="icon-sm" variant="ghost" aria-label={`缩小${noun}`} onClick={() => step(-1)}>
          <Minus />
        </Button>
        <Button
          title="重置缩放到 100%"
          aria-label="重置缩放到 100%"
          className="tabular-nums"
          onClick={() => setZoom(1)}
          size="sm"
          variant="ghost"
        >
          {Math.round(zoom * 100)}%
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`放大${noun}`} onClick={() => step(1)}>
          <Plus />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={pinchZoomRef(setZoom, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP)}
          className="absolute inset-0 overflow-auto overscroll-contain bg-inset [overflow-anchor:none] [scrollbar-gutter:stable]"
        >
          {/* 幻灯片按容器宽度重排，CSS zoom 会被抵消，改为放大容器宽度。 */}
          <div
            ref={host}
            style={kind === 'pptx' ? { width: `${zoom * 100}%` } : { zoom }}
            className={cn(
              'office-preview mx-auto min-h-full p-4',
              kind !== 'pptx' && 'w-max min-w-full',
            )}
          />
        </div>
        {error && (
          <ErrorText size="sm" className="absolute inset-x-0 top-0 bg-surface p-3">
            {noun}打开失败：{error}
            <InlineButton className="ml-2" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </InlineButton>
          </ErrorText>
        )}
        {loading && !error && (
          <p role="status" className="absolute inset-x-0 top-0 p-3 text-sm text-ink-3">
            正在加载{noun}…
          </p>
        )}
      </div>
      {sheets.length > 0 && (
        <div
          role="tablist"
          aria-label="工作表"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-t px-2 py-1"
        >
          {sheets.map((name, index) => (
            <Button
              key={index}
              size="sm"
              role="tab"
              aria-selected={index === activeSheet}
              variant={index === activeSheet ? 'secondary' : 'ghost'}
              onClick={() => selectSheet(index)}
            >
              {name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
