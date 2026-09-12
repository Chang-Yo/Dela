import { useEffect, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  FilePenLine,
  FolderOpen,
  Link2,
  LoaderCircle,
  RefreshCw,
  Save,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { SourceDetail } from '../sources/SourceDetail';
import { errorText, useWorkspace } from './workspace';

export function ProjectDocument({
  documentKey,
  readOnly = false,
  scroll = 0,
  onScroll,
  onQuote,
  onLinkSource,
  onNewNote,
  onOpenSource,
}: {
  documentKey: string;
  readOnly?: boolean;
  scroll?: number;
  onScroll: (top: number) => void;
  onQuote: (text: string) => void;
  onLinkSource: (key: string) => void;
  onNewNote: (text: string) => void;
  onOpenSource: (key: string) => void;
}) {
  const draft = useWorkspace((s) => s.drafts[documentKey]);
  const entry = useWorkspace((s) => s.workspace.entries.find((e) => e.id === documentKey));
  const canvas = useWorkspace((s) => s.canvas);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const sourceId = documentKey.startsWith('source:') ? documentKey.slice(7) : entry?.sourceId;
  const source = sourceId ? canvas.items.find((i) => i.sourceId === sourceId) : undefined;
  const course = canvas.courses.find((c) => c.id === source?.courseId);
  const editable = entry?.kind === 'note' && !readOnly;
  useEffect(() => {
    let active = true;
    setError(null);
    const refresh = () => {
      const state = useWorkspace.getState();
      const current = state.drafts[documentKey];
      if (current && (current.saving || current.text !== current.saved)) return;
      void state.read(documentKey, true).catch((e) => {
        if (active) setError(errorText(e));
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [documentKey]);
  useEffect(() => {
    if (editor.current) editor.current.scrollTop = scroll;
  }, [documentKey, preview]);
  const run = (work: Promise<unknown>) => {
    setError(null);
    void work.catch((e) => setError(errorText(e)));
  };
  const link = (url: string) => {
    try {
      const parsed = new URL(url);
      const file =
        parsed.origin === 'https://oc.sjtu.edu.cn'
          ? parsed.pathname.match(/\/files\/(\d+)/)?.[1]
          : null;
      if (file && canvas.items.some((i) => i.sourceId === `file:${file}`))
        onOpenSource(`source:file:${file}`);
      else if (window.dela) run(window.dela.canvas.openLink(url));
    } catch {
      setError('不支持的链接');
    }
  };
  if (!draft)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button
              variant="ghost"
              onClick={() => {
                setError(null);
                run(useWorkspace.getState().read(documentKey, true));
              }}
            >
              重试
            </Button>
          </div>
        ) : (
          <>
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            正在打开…
          </>
        )}
      </div>
    );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={`文档：${entry?.name ?? draft.content.title}`}
    >
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          <p className="truncate" title={course?.name ?? entry?.name ?? draft.content.title}>
            {course ? `${course.name} · Canvas` : (entry?.name ?? draft.content.title)}
          </p>
          {draft.content.dueAt && (
            <p>截止 {new Date(draft.content.dueAt).toLocaleString('zh-CN')}</p>
          )}
        </div>
        {editable && (
          <>
            <span className="mr-2 text-xs text-muted-foreground" role="status">
              {draft.error
                ? '保存失败'
                : draft.saving
                  ? '保存中…'
                  : draft.text === draft.saved
                    ? '已保存'
                    : '未保存'}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPreview((v) => !v)}>
              {preview ? '编辑' : '预览'}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="保存笔记"
              aria-label="保存笔记"
              onClick={() => run(useWorkspace.getState().save(documentKey))}
            >
              <Save />
            </Button>
          </>
        )}
        {sourceId && !readOnly && (
          <Button
            size="icon-sm"
            variant="ghost"
            title="加入文件夹或项目"
            aria-label="加入文件夹或项目"
            onClick={() => onLinkSource(documentKey)}
          >
            <Link2 />
          </Button>
        )}
        {!readOnly && (
          <Button
            size="icon-sm"
            variant="ghost"
            title="记笔记"
            aria-label="记笔记"
            onClick={() => onNewNote('')}
          >
            <FilePenLine />
          </Button>
        )}
        {sourceId?.startsWith('file:') && (
          <Button
            size="icon-sm"
            variant="ghost"
            title="下载文件"
            aria-label="下载文件"
            onClick={() => window.dela && run(window.dela.canvas.download(sourceId))}
          >
            <Download />
          </Button>
        )}
        {draft.content.url && (
          <Button
            size="icon-sm"
            variant="ghost"
            title="打开原文"
            aria-label="打开原文"
            onClick={() => link(draft.content.url!)}
          >
            <ExternalLink />
          </Button>
        )}
        {(entry?.kind === 'local' || entry?.kind === 'note') && (
          <Button
            size="icon-sm"
            variant="ghost"
            title="在文件夹中显示"
            aria-label="在文件夹中显示"
            onClick={() => window.dela && run(window.dela.workspace.openLocal(documentKey))}
          >
            <FolderOpen />
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          title="重新载入"
          aria-label="重新载入"
          onClick={() => {
            if (
              draft.text === draft.saved ||
              window.confirm('重新载入会抛弃当前未保存的草稿，是否继续？')
            )
              run(useWorkspace.getState().read(documentKey, true));
          }}
        >
          <RefreshCw />
        </Button>
      </div>
      {(error || draft.error) && (
        <div role="alert" className="shrink-0 border-b px-4 py-2 text-xs text-destructive">
          {error ?? draft.error}
          {draft.error && (
            <button className="ml-3 underline" onClick={() => onNewNote(draft.text)}>
              另存为新笔记
            </button>
          )}
        </div>
      )}
      {editable && !preview ? (
        <textarea
          ref={editor}
          aria-label="笔记编辑器"
          spellCheck={false}
          className="min-h-0 w-full flex-1 resize-none border-0 bg-background p-6 font-mono text-sm leading-relaxed outline-none"
          placeholder="开始记录…"
          value={draft.text}
          onChange={(event) => useWorkspace.getState().edit(documentKey, event.target.value)}
          onBlur={() => void useWorkspace.getState().save(documentKey)}
          onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 's') {
              event.preventDefault();
              void useWorkspace.getState().save(documentKey);
            }
          }}
        />
      ) : (
        <SourceDetail
          content={draft.content}
          text={draft.text}
          onQuote={onQuote}
          onLink={link}
          scroll={scroll}
          onScroll={onScroll}
        />
      )}
    </section>
  );
}
