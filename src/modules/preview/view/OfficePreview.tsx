import { Minus, MoveHorizontal, Plus } from 'lucide-react';
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

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

const kindNoun: Record<OfficeKind, string> = { docx: '文档', xlsx: '表格', pptx: '演示文稿' };

export function OfficePreview({ url, kind }: { url: string; kind: OfficeKind }) {
  const host = useRef<HTMLDivElement>(null);
  const workbook = useRef<XlsxInstance | null>(null);
  const [attempt, setAttempt] = useState(0);
  const run = `${attempt}:${url}`;
  const [result, setResult] = useState<{
    run: string;
    error: string;
    sheets: string[];
    slideWidth: number;
  } | null>(null);
  const loading = result?.run !== run;
  const error = loading ? '' : result.error;
  const sheets = loading ? [] : result.sheets;
  const [activeSheet, setActiveSheet] = useState(0);
  // 'fit' 与 PDF 的适合宽度一致：随面板宽度持续重算，手动缩放后退出。
  const [zoom, setZoom] = useState<number | 'fit'>(kind === 'pptx' ? 'fit' : 1);
  const [available, setAvailable] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
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
        const slideWidth = parseFloat(
          container.querySelector<HTMLElement>('.pl-root')?.style.getPropertyValue('--pl-w') ?? '',
        );
        setActiveSheet(0);
        setResult({ run, error: '', sheets: sheetNames, slideWidth: slideWidth || 0 });
      } catch (cause) {
        if (!signal.aborted)
          setResult({ run, error: errorMessage(cause), sheets: [], slideWidth: 0 });
      }
    })();
    return () => {
      controller.abort();
      instance?.destroy();
      workbook.current = null;
    };
  }, [run, url, kind]);
  const naturalWidth = kind === 'pptx' ? (result?.slideWidth ?? 0) : contentWidth;
  const fitScale = naturalWidth > 0 && available > 0 ? clampZoom(available / naturalWidth) : 1;
  const scale = zoom === 'fit' ? fitScale : zoom;
  const resolve = (value: number | 'fit') => (value === 'fit' ? fitScale : value);
  const step = (direction: number) =>
    setZoom((value) => clampZoom(resolve(value) + direction * ZOOM_STEP));
  // 可用宽度扣除滚动区内边距；docx/xlsx 的原始宽度按当前 zoom 反推，取整避免适合宽度来回抖动。
  const observeScroller = (scroller: HTMLDivElement) => {
    const content = scroller.firstElementChild as HTMLElement;
    const measure = () => {
      const style = getComputedStyle(scroller);
      setAvailable(
        scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      );
      if (kind !== 'pptx')
        setContentWidth(
          Math.round(
            content.getBoundingClientRect().width / (Number(getComputedStyle(content).zoom) || 1),
          ),
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(content);
    const stopPinch = pinchZoomRef(
      (update) => setZoom((value) => update(resolve(value))),
      MIN_ZOOM,
      MAX_ZOOM,
      ZOOM_STEP,
    )(scroller);
    return () => {
      observer.disconnect();
      stopPinch();
    };
  };
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
          {Math.round(scale * 100)}%
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="适合宽度"
          aria-label="适合宽度"
          onClick={() => setZoom('fit')}
        >
          <MoveHorizontal />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`放大${noun}`} onClick={() => step(1)}>
          <Plus />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={observeScroller}
          className="absolute inset-0 overflow-auto overscroll-contain bg-inset p-4 [overflow-anchor:none] [scrollbar-gutter:stable]"
        >
          {/* 幻灯片按容器宽度重排，CSS zoom 会被抵消，改为按原始页宽设容器宽度。 */}
          <div
            ref={host}
            style={
              kind !== 'pptx'
                ? { zoom: scale }
                : naturalWidth
                  ? { width: scale * naturalWidth }
                  : undefined
            }
            className={cn('office-preview mx-auto min-h-full', kind !== 'pptx' && 'w-max')}
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
