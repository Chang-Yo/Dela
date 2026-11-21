import { lazy, Suspense, useEffect, useEffectEvent } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '../../../ui/button';
import { Card } from '../../../ui/card';
import { HtmlFrame } from '../../../ui/html-frame';
import { showToast } from '../../../ui/toast';
import { CodeViewer } from './CodeViewer';
import { useContentLoader, type LoadedDocument } from './loader';
import { OfficeExportBanner, OfficePromptCard } from './OfficePrompt';
import { previewScrollOf, rememberPreviewScroll } from './scroll-memory';
import { parsePreviewTabId } from './tab-id';
import { Spinner } from '../../../ui/spinner';
import { errorMessage } from '../../../core/protocol/contract';
import type { TabId } from '../../../core/protocol/workbench';

const PdfReader = lazy(() =>
  import('./PdfReader').then((module) => ({ default: module.PdfReader })),
);
const DocxPreview = lazy(() =>
  import('./DocxPreview').then((module) => ({ default: module.DocxPreview })),
);
const SheetPreview = lazy(() =>
  import('./SheetPreview').then((module) => ({ default: module.SheetPreview })),
);
/** 模块来源优先于格式；本地文本文件与所有 Markdown 走 note: 标签，不进这里。 */
export type PreviewBranch =
  'source' | 'html' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'binary';

function previewBranchOf(doc: LoadedDocument): PreviewBranch {
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

export function PreviewTab({ tabId, groupId }: { tabId: TabId; groupId: string }) {
  const loader = useContentLoader();
  const query = useQuery({
    queryKey: ['preview', tabId],
    queryFn: () => loader.loadDocument(tabId),
    enabled: parsePreviewTabId(tabId) !== null,
    gcTime: 0,
  });
  const doc = query.data;
  const error = query.isError && !doc && !query.isFetching ? errorMessage(query.error) : null;
  const scrollKey = `${tabId}:${groupId}`;
  const initialScroll = () => previewScrollOf(scrollKey);
  const onScroll = (top: number) => rememberPreviewScroll(scrollKey, top);

  const load = () =>
    void query.refetch().then((result) => {
      if (result.isError && result.data)
        showToast({
          variant: 'error',
          title: '重新读取文件失败',
          description: errorMessage(result.error),
        });
    });

  const watchesDisk = doc?.watchesDisk === true;
  const reloadOnFocus = useEffectEvent(load);
  useEffect(() => {
    if (!watchesDisk) return;
    const onFocus = () => reloadOnFocus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [watchesDisk]);

  const content = doc?.content;

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
      {branch === 'html' && (
        <Card className="min-h-0 flex-1">
          {/* 本地/导入条目（watchesDisk）不补 Canvas 基址，相对地址剥除，免得补到外域泄露请求。 */}
          <HtmlFrame
            baseUrl={doc.watchesDisk ? undefined : 'https://oc.sjtu.edu.cn'}
            className="bg-paper"
            fill
            html={content.text ?? ''}
            initialScroll={initialScroll}
            onLink={openLink}
            onScroll={onScroll}
            title={content.title}
          />
        </Card>
      )}
      {branch === 'pdf' &&
        (content.previewUrl ? (
          <Suspense fallback={<p className="p-4 text-sm text-ink-3">正在加载阅读器…</p>}>
            <PdfReader
              key={content.previewUrl}
              url={content.previewUrl}
              initialScroll={initialScroll}
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
              officeAddress={doc.officeAddress}
              onExported={onOfficeRefresh}
            />
          )}
          {exported?.previewUrl ? (
            <Suspense fallback={<p className="p-4 text-sm text-ink-3">正在加载阅读器…</p>}>
              <PdfReader
                key={exported.previewUrl}
                url={exported.previewUrl}
                initialScroll={initialScroll}
                onScroll={onScroll}
              />
            </Suspense>
          ) : (
            <OfficePromptCard
              title={content.title}
              officeAddress={doc.officeAddress}
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
          initialScroll={initialScroll}
          onScroll={onScroll}
        />
      )}
    </section>
  );
}
