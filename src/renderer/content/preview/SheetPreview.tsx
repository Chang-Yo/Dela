import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '../../components/ui/button';
import { errorText } from '../../workspace/store';
import { usePinchZoom } from './use-pinch-zoom';

// 单工作表最多解析的行数：防超大表同步渲染冻结 renderer。
const SHEET_ROW_LIMIT = 2000;
// 缩放范围与步进：与 PdfReader 的 10% 步进一致。
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

interface SheetTab {
  name: string;
  table: string;
  truncated: boolean;
}

/**
 * SheetJS 的 html 输出对富文本与自定义数字格式存在未转义的注入面，
 * 经 DOMParser 清理（与邮件 HTML 预览同一模式）后再上屏。
 */
export function sanitizeTableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll('script,iframe,object,embed,form,base,meta,link,style')
    .forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes))
      if (attr.name.startsWith('on') || attr.name === 'srcdoc') el.removeAttribute(attr.name);
  });
  // 链接协议走 URL 白名单而非正则黑名单：URL 解析会剥掉 scheme 内的 tab/换行，
  // `java&#9;script:` 这类实体编码可绕过黑名单（解析后即 javascript:）。
  doc.querySelectorAll('a[href]').forEach((a) => {
    try {
      // 无文档基址：相对链接一并剥除，只保留绝对 http(s)。
      if (!['https:', 'http:'].includes(new URL(a.getAttribute('href')!).protocol))
        a.removeAttribute('href');
    } catch {
      a.removeAttribute('href');
    }
  });
  return doc.body.innerHTML;
}

function tableHtml(sheet: XLSX.WorkSheet): string {
  const html = XLSX.utils.sheet_to_html(sheet);
  const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
  return table ? sanitizeTableHtml(table) : '';
}

function sheetTruncated(sheet: XLSX.WorkSheet): boolean {
  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  return !!range && range.e.r + 1 >= SHEET_ROW_LIMIT;
}

export function SheetPreview({ url }: { url: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [sheets, setSheets] = useState<SheetTab[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  usePinchZoom(scroller, setZoom, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setSheets([]);
    setLoaded(false);
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // cellHTML:false：禁用富文本 .h 生成（SheetJS 对其不做 HTML 转义），一律走转义后的显示值。
        const workbook = XLSX.read(new Uint8Array(await response.arrayBuffer()), {
          type: 'array',
          cellHTML: false,
          sheetRows: SHEET_ROW_LIMIT,
        });
        if (controller.signal.aborted) return;
        setSheets(
          workbook.SheetNames.map((name) => {
            const sheet = workbook.Sheets[name]!;
            return { name, table: tableHtml(sheet), truncated: sheetTruncated(sheet) };
          }),
        );
        setActive(0);
        setLoaded(true);
      } catch (cause) {
        if (!controller.signal.aborted) setError(errorText(cause));
      }
    })();
    return () => controller.abort();
  }, [url, attempt]);
  const step = (direction: number) =>
    setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + direction * ZOOM_STEP)));
  const current = sheets[active];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-center-safe gap-2 overflow-x-auto border-b px-3 py-1 text-xs">
        <Button size="icon-sm" variant="ghost" aria-label="缩小表格" onClick={() => step(-1)}>
          <Minus />
        </Button>
        <button
          title="重置缩放到 100%"
          aria-label="重置缩放到 100%"
          className="rounded-control px-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bui-accent"
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button size="icon-sm" variant="ghost" aria-label="放大表格" onClick={() => step(1)}>
          <Plus />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          className="absolute inset-0 overflow-auto overscroll-contain bg-surface [overflow-anchor:none] [scrollbar-gutter:stable]"
        >
          {loaded && !sheets.length && <p className="p-6 text-13 text-ink-3">工作簿没有工作表。</p>}
          {current && (
            <div style={{ zoom }} className="inline-block min-w-full p-4 text-xs">
              {current.truncated && (
                <p role="status" className="mb-2 text-ink-3">
                  表格较大，仅显示前 {SHEET_ROW_LIMIT} 行。
                </p>
              )}
              <div
                className="[&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-inset [&_th]:px-2 [&_th]:py-1"
                dangerouslySetInnerHTML={{ __html: current.table }}
              />
            </div>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="absolute inset-x-0 top-0 break-words bg-surface p-3 text-13 text-red"
          >
            表格打开失败：{error}
            <button className="ml-2 underline" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          </p>
        )}
        {!loaded && !error && (
          <p role="status" className="absolute inset-x-0 top-0 p-3 text-13 text-ink-3">
            正在加载表格…
          </p>
        )}
      </div>
      {sheets.length > 0 && (
        <div
          role="tablist"
          aria-label="工作表"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-t px-2 py-1"
        >
          {sheets.map((sheet, index) => (
            <Button
              key={sheet.name}
              size="sm"
              role="tab"
              aria-selected={index === active}
              variant={index === active ? 'secondary' : 'ghost'}
              onClick={() => setActive(index)}
            >
              {sheet.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
