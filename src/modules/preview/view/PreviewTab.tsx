import { lazy, Suspense, useEffect, useEffectEvent } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '../../../ui/button';
import { useRootFontSize } from '../../../renderer/lib/root-font-size';
import { sanitizeHtml } from '../../../renderer/lib/sanitize-html';
import { showToast } from '../../../renderer/app/toasts';
import { errorText } from '../../../renderer/workspace/store';
import type { TabId } from '../../workspace/contract';
import { CodeViewer } from './CodeViewer';
import { useContentLoader, type LoadedDocument } from './loader';
import { OfficeExportBanner, OfficePromptCard } from './OfficePrompt';
import { rememberPreviewScroll, usePreviewScroll } from './scroll-memory';
import { parsePreviewTabId } from './tab-id';
import { Spinner } from '../../../ui/spinner';

const PdfReader = lazy(() =>
  import('./PdfReader').then((module) => ({ default: module.PdfReader })),
);
const DocxPreview = lazy(() =>
  import('./DocxPreview').then((module) => ({ default: module.DocxPreview })),
);
const SheetPreview = lazy(() =>
  import('./SheetPreview').then((module) => ({ default: module.SheetPreview })),
);
/** 分流决策（纯函数）：模块来源优先于格式。预览里的文本都是只读的（远端、资料）：
 *  本地文本文件与所有 Markdown 走 note: 标签，不进这里。 */
export type PreviewBranch =
  'source' | 'html' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'binary';

export function previewBranchOf(doc: LoadedDocument): PreviewBranch {
  if (doc.source) return 'source';
  const { format } = doc.content;
  if (
    format === 'html' ||
    format === 'pdf' ||
    format === 'image' ||
    format === 'docx' ||
    format === 'xlsx' ||
    format === 'pptx' ||
    format === 'binary'
  )
    return format;
  return 'text';
}

/** 文件预览标签内容：按 DocumentContent.format 分流到各预览器。文档加载经注入的
 *  ContentLoader，本域不感知条目树与读取 IPC。 */
export function PreviewTab({ tabId, groupId }: { tabId: TabId; groupId: string }) {
  const loader = useContentLoader();
  // 文档可能带着整份文件字节，只为打开中的标签保留。
  const query = useQuery({
    queryKey: ['preview', tabId],
    queryFn: () => loader.loadDocument(tabId),
    enabled: parsePreviewTabId(tabId) !== null,
    gcTime: 0,
  });
  const doc = query.data;
  // 首次加载失败用占位错误（带重试）；已加载后的重读失败走浮窗，不打断当前内容。
  const error = query.isError && !doc && !query.isFetching ? errorText(query.error) : null;
  const scrollKey = `${tabId}:${groupId}`;
  const scroll = usePreviewScroll.getState()[scrollKey] ?? 0;
  const onScroll = (top: number) => rememberPreviewScroll(scrollKey, top);

  const load = () =>
    void query.refetch().then((result) => {
      if (result.isError && result.data)
        showToast({
          variant: 'error',
          title: '重新读取文件失败',
          description: errorText(result.error),
        });
    });

  // 本地磁盘文件可能被外部编辑：窗口聚焦时重读（只读预览无草稿，直接重读）。
  const watchesDisk = doc?.watchesDisk === true;
  const reloadOnFocus = useEffectEvent(load);
  useEffect(() => {
    if (!watchesDisk) return;
    const onFocus = () => reloadOnFocus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [watchesDisk]);

  const content = doc?.content;
  /* HTML 消毒基址：Canvas 来源的相对地址补全到 Canvas 域；本地/导入条目（watchesDisk，
     Loader 接线里即 entry kind local/imported 的近似标记）不补外域 base——空 base 下
     绝对 http(s) 链接保留、相对地址剥除，避免相对地址被补到 Canvas 域造成跨域请求泄露。
     iframe 固定为可视高度、无高度上报，内层文档自己滚（'auto'），阅读位置才记得住。 */
  const rootSize = useRootFontSize();
  const html =
    content?.format === 'html' && !doc?.source
      ? sanitizeHtml(
          content.text,
          doc?.watchesDisk ? '' : 'https://oc.sjtu.edu.cn',
          rootSize,
          'auto',
        )
      : '';

  if (!parsePreviewTabId(tabId))
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-sm text-ink-3">
        无效的预览标签：{tabId}
      </div>
    );
  if (!doc || !content)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-sm text-ink-3">
        {error ? (
          <div role="alert" className="min-w-0">
            <p className="break-words">{error}</p>
            <Button variant="ghost" onClick={() => load()}>
              重试
            </Button>
          </div>
        ) : (
          <>
            <Spinner className="mr-2" />
            正在打开…
          </>
        )}
      </div>
    );

  const branch = previewBranchOf(doc);
  const SourceDocument = doc.source?.document;
  const exported = content.office?.export;
  const bytes = content.bytes;
  const openLink = (url: string) => loader.openLink(url);
  const onOfficeRefresh = () => {
    load();
    loader.onExported?.(tabId);
  };

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={`文档：${content.title}`}
    >
      {SourceDocument && (
        <SourceDocument
          content={content}
          navigate={loader.navigate}
          onReload={load}
          sourceId={doc.source!.id}
        />
      )}
      {/* 白底文档以圆角卡片呈现：暗色模式下避免白色大块与深色界面生硬相接。 */}
      {branch === 'html' && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-card border border-line">
          <iframe
            title={content.title}
            className="size-full border-0 bg-paper"
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            srcDoc={html}
            onLoad={(event) => {
              const frame = event.currentTarget;
              const frameDoc = frame.contentDocument;
              if (!frameDoc) return;
              frame.contentWindow?.scrollTo(0, scroll);
              frameDoc.addEventListener('click', (e) => {
                const target = (e.target as Element).closest?.('a[href]');
                if (target) {
                  e.preventDefault();
                  openLink(target.getAttribute('href')!);
                }
              });
              frame.contentWindow?.addEventListener('scroll', () =>
                onScroll(frame.contentWindow?.scrollY ?? 0),
              );
            }}
          />
        </div>
      )}
      {branch === 'pdf' &&
        (content.previewUrl ? (
          <Suspense fallback={<p className="p-4 text-sm text-ink-3">正在加载阅读器…</p>}>
            <PdfReader
              key={content.previewUrl}
              url={content.previewUrl}
              scroll={scroll}
              onScroll={onScroll}
            />
          </Suspense>
        ) : (
          <p className="p-4 text-sm text-ink-3">正在准备预览…</p>
        ))}
      {branch === 'image' && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {bytes && (
            <img
              alt={content.title}
              className="max-w-full"
              ref={(image) => {
                if (!image) return;
                const url = URL.createObjectURL(
                  new Blob([new Uint8Array(bytes)], { type: content.mime }),
                );
                image.src = url;
                return () => URL.revokeObjectURL(url);
              }}
            />
          )}
        </div>
      )}
      {(branch === 'docx' || branch === 'xlsx') &&
        (content.previewUrl ? (
          <Suspense fallback={<p className="p-4 text-sm text-ink-3">正在加载预览…</p>}>
            {branch === 'docx' ? (
              <DocxPreview key={content.previewUrl} url={content.previewUrl} />
            ) : (
              <SheetPreview key={content.previewUrl} url={content.previewUrl} />
            )}
          </Suspense>
        ) : (
          <p className="p-4 text-sm text-ink-3">正在准备预览…</p>
        ))}
      {branch === 'pptx' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {exported && (
            <OfficeExportBanner
              exported={exported}
              officeRef={doc.officeRef}
              onExported={onOfficeRefresh}
            />
          )}
          {exported?.previewUrl ? (
            <Suspense fallback={<p className="p-4 text-sm text-ink-3">正在加载阅读器…</p>}>
              <PdfReader
                key={exported.previewUrl}
                url={exported.previewUrl}
                scroll={scroll}
                onScroll={onScroll}
              />
            </Suspense>
          ) : (
            <OfficePromptCard
              title={content.title}
              officeRef={doc.officeRef}
              onExported={onOfficeRefresh}
            />
          )}
        </div>
      )}
      {branch === 'binary' && (
        <p className="p-6 text-sm text-ink-3">
          这个文件不是 UTF-8 文本或体积过大，无法内嵌预览，请下载文件或用默认程序打开。
        </p>
      )}
      {content.truncated && branch === 'text' && (
        <p className="shrink-0 border-b px-4 py-2 text-xs text-ink-3">
          文件超过 1 MB，这里只显示开头部分。
        </p>
      )}
      {branch === 'text' && (
        <CodeViewer
          value={content.text ?? ''}
          filename={content.title}
          scroll={scroll}
          onScroll={onScroll}
        />
      )}
    </section>
  );
}
