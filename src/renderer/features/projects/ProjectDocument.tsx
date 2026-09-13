import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  Link2,
  LoaderCircle,
  PenLine,
  RefreshCw,
  Save,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { SourceDetail } from '../sources/SourceDetail';
import { MarkdownEditor } from './MarkdownEditor';
import { errorText, useWorkspace } from './workspace';

export function ProjectDocument({
  documentKey,
  readOnly = false,
  scroll = 0,
  onScroll,
  onQuote,
  onReveal,
  onLinkSource,
  onNewNote,
  onOpenSource,
}: {
  documentKey: string;
  readOnly?: boolean;
  scroll?: number;
  onScroll: (top: number) => void;
  onQuote: (text: string) => void;
  onReveal: (id: string) => void;
  onLinkSource: (key: string) => void;
  onNewNote: (text: string) => void;
  onOpenSource: (key: string) => void;
}) {
  const draft = useWorkspace((s) => s.drafts[documentKey]);
  const entries = useWorkspace((s) => s.workspace.entries);
  const entry = useWorkspace((s) => s.workspace.entries.find((e) => e.id === documentKey));
  const canvas = useWorkspace((s) => s.canvas);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const sourceId = documentKey.startsWith('source:') ? documentKey.slice(7) : entry?.sourceId;
  const source = sourceId ? canvas.items.find((i) => i.sourceId === sourceId) : undefined;
  const course = canvas.courses.find((c) => c.id === source?.courseId);
  const editable = entry?.kind === 'note' && !readOnly;
  /* 面包屑：所属项目链（可点击在目录中定位）+ Canvas 课程与目录链（只读上下文）。 */
  const crumbs = useMemo(() => {
    const list: { key: string; label: string; onOpen?: () => void }[] = [];
    let parent = entry?.parentId;
    while (parent) {
      const node = entries.find((e) => e.id === parent);
      if (!node) break;
      list.unshift({ key: node.id, label: node.name, onOpen: () => onReveal(node.id) });
      parent = node.parentId;
    }
    if (course) list.push({ key: `course:${course.id}`, label: `${course.name} · Canvas` });
    if (source) {
      const trail: string[] = [];
      let nodeId = source.parentId;
      while (nodeId) {
        const node = canvas.items.find((i) => i.id === nodeId);
        if (!node) break;
        trail.unshift(node.name);
        nodeId = node.parentId;
      }
      trail.forEach((label, index) => list.push({ key: `trail:${index}:${label}`, label }));
    }
    return list;
  }, [entries, entry?.parentId, course, source, canvas.items, onReveal]);
  useEffect(() => {
    let active = true;
    setError(null);
    const refresh = (force = false) => {
      const state = useWorkspace.getState();
      const current = state.drafts[documentKey];
      if (current && (current.saving || current.text !== current.saved)) return;
      void state.read(documentKey, force).catch((e) => {
        if (active) setError(errorText(e));
      });
    };
    refresh();
    const refreshLocal = () => refresh(true);
    if (!sourceId) window.addEventListener('focus', refreshLocal);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshLocal);
    };
  }, [documentKey, sourceId]);
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
        <nav
          aria-label="所在位置"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
        >
          {crumbs.map((crumb, index) => (
            <span key={crumb.key} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" />}
              {crumb.onOpen ? (
                <button
                  className="max-w-40 truncate rounded hover:text-foreground hover:underline"
                  title={crumb.label}
                  onClick={crumb.onOpen}
                >
                  {crumb.label}
                </button>
              ) : (
                <span className="max-w-40 truncate" title={crumb.label}>
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
          {draft.content.dueAt && (
            <span className="ml-1 flex shrink-0 items-center gap-1">
              <Clock className="size-3" />
              截止 {new Date(draft.content.dueAt).toLocaleString('zh-CN')}
            </span>
          )}
        </nav>
        {editable && (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              title={preview ? '返回编辑' : '预览'}
              aria-label={preview ? '返回编辑' : '预览'}
              onClick={() => setPreview((v) => !v)}
            >
              {preview ? <PenLine /> : <Eye />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title={draft.text === draft.saved ? '已保存' : '保存 (Ctrl+S)'}
              aria-label="保存笔记"
              disabled={draft.saving || draft.text === draft.saved}
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
        <MarkdownEditor
          value={draft.text}
          scroll={scroll}
          onChange={(text) => useWorkspace.getState().edit(documentKey, text)}
          onSave={() => void useWorkspace.getState().save(documentKey)}
          onScroll={onScroll}
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
