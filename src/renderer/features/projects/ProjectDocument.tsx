import { useEffect, useMemo, useState } from 'react';
import { Dialog } from 'radix-ui';
import {
  ChevronRight,
  CopyPlus,
  Clock,
  Code,
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
import { ShuiyuanSourceDoc } from '../shuiyuan/SourceRefCard';
import { MarkdownEditor } from './MarkdownEditor';
import { NoteEditor } from './NoteEditor';
import { errorText, useWorkspace } from './workspace';
import {
  externalOpenTarget,
  isRelativeAssetPath,
  markdownRequiresSourceMode,
  noteAssetUrl,
} from '../../../shared/note-files';

/* 笔记编辑模式（本次会话内按文档记忆；含 frontmatter 等不支持语法的文档强制源码模式）。 */
type NoteMode = 'rich' | 'read' | 'source';
const noteModes = new Map<string, NoteMode>();

export function ProjectDocument({
  documentKey,
  viewId = 'primary',
  readOnly = false,
  scroll = 0,
  onScroll,
  onReveal,
  onLinkSource,
  onNewNote,
  onOpenSource,
  onOpenShuiyuanTopic,
  onOpenEntry,
}: {
  documentKey: string;
  /** Distinguishes editor groups so each keeps its own cursor, scroll and undo history. */
  viewId?: string;
  readOnly?: boolean;
  scroll?: number;
  onScroll: (top: number) => void;
  onReveal: (id: string) => void;
  onLinkSource: (key: string) => void;
  onNewNote: (text: string) => void;
  onOpenSource: (key: string) => void;
  onOpenShuiyuanTopic?: (topicId: number, postNumber?: number) => void;
  /** 打开新创建的条目（笔记副本等）。 */
  onOpenEntry?: (id: string) => void;
}) {
  const draft = useWorkspace((s) => s.drafts[documentKey]);
  const entries = useWorkspace((s) => s.workspace.entries);
  const entry = useWorkspace((s) => s.workspace.entries.find((e) => e.id === documentKey));
  const canvas = useWorkspace((s) => s.canvas);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const [mode, setMode] = useState<NoteMode>(() => noteModes.get(documentKey) ?? 'rich');
  const sourceId = documentKey.startsWith('source:') ? documentKey.slice(7) : entry?.sourceId;
  const shuiyuanTopicId = sourceId?.startsWith('shuiyuan-topic:')
    ? Number(sourceId.slice('shuiyuan-topic:'.length))
    : null;
  const source = sourceId ? canvas.items.find((i) => i.sourceId === sourceId) : undefined;
  const course = canvas.courses.find((c) => c.id === source?.courseId);
  const isNote = entry?.kind === 'note';
  const editable = isNote && !readOnly;
  const markdown = draft?.content.format === 'markdown';
  // frontmatter 等会被所见即所得内核破坏的语法：整篇停留源码模式。
  const forcedSource = markdown && markdownRequiresSourceMode(draft?.text ?? '');
  const effectiveMode: NoteMode = forcedSource ? 'source' : mode;
  const changeMode = (next: NoteMode) => {
    noteModes.set(documentKey, next);
    setMode(next);
  };
  const dirty = draft ? draft.text !== draft.saved : false;
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
    if (shuiyuanTopicId !== null) list.push({ key: 'shuiyuan', label: '水源社区' });
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
  }, [entries, entry?.parentId, course, source, canvas.items, onReveal, shuiyuanTopicId]);
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
  /* 代码文件进 VS Code，PDF、图片等交给系统默认应用；主进程按条目 ID 解析实际文件。 */
  const fileEntry =
    entry?.kind === 'local' || entry?.kind === 'imported' || entry?.kind === 'source';
  const openTarget = entry ? externalOpenTarget(entry.name) : 'system';
  const openExternally = () => {
    if (window.dela) run(window.dela.workspace.openExternal(documentKey));
  };
  /* 导入的 Markdown 制作可编辑副本（携带可访问的本地图片）后打开。 */
  const createCopy = () => {
    if (!window.dela || !entry) return;
    setNotice(null);
    run(
      window.dela.workspace.createNoteCopy(documentKey, entry.parentId).then((result) => {
        onOpenEntry?.(result.entry.id);
        if (result.missing.length)
          setNotice(
            `已创建笔记副本；${result.missing.length} 张图片无法携带：${result.missing.join('、')}`,
          );
      }),
    );
  };
  /* 相对图片经受限资源协议解析显示；远程与绝对地址保持原样。 */
  const resolveImage = (src: string) =>
    isRelativeAssetPath(src) ? noteAssetUrl(documentKey, src) : src;
  /* 点击时刻取实时 Canvas 快照：HTML 文档 iframe 的监听闭包可能早于最新同步。 */
  const link = (url: string) => {
    try {
      const parsed = new URL(url);
      const file =
        parsed.origin === 'https://oc.sjtu.edu.cn'
          ? parsed.pathname.match(/\/files\/(\d+)/)?.[1]
          : null;
      if (file && useWorkspace.getState().canvas.items.some((i) => i.sourceId === `file:${file}`))
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
          <div role="alert" className="min-w-0">
            <p className="break-words">{error}</p>
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
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1 text-2xs">
        <nav
          aria-label="所在位置"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-muted-foreground"
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
        </nav>
        <div
          className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1"
          role="toolbar"
          aria-label="文档操作"
        >
          {draft.content.dueAt && (
            <span
              className="ml-1 flex min-w-0 shrink items-center gap-1"
              title={`截止 ${new Date(draft.content.dueAt).toLocaleString('zh-CN')}`}
            >
              <Clock className="size-3 shrink-0" />
              <span className="max-w-40 truncate">
                截止 {new Date(draft.content.dueAt).toLocaleString('zh-CN')}
              </span>
            </span>
          )}
          <span
            className={`ml-auto flex shrink-0 items-center gap-1 ${
              draft.error ? 'text-destructive' : 'text-muted-foreground'
            }`}
            role="status"
            aria-live="polite"
          >
            {draft.saving && <LoaderCircle className="size-3 animate-spin" />}
            {!editable ? '只读' : draft.saving ? '保存中…' : dirty ? '未保存' : '已保存'}
          </span>
          {editable && markdown && effectiveMode !== 'source' && (
            <Button
              size="icon-sm"
              variant="ghost"
              title={effectiveMode === 'read' ? '编辑' : '阅读模式'}
              aria-label={effectiveMode === 'read' ? '编辑' : '阅读模式'}
              onClick={() => changeMode(effectiveMode === 'read' ? 'rich' : 'read')}
            >
              {effectiveMode === 'read' ? <PenLine /> : <Eye />}
            </Button>
          )}
          {fileEntry && entry && (
            <Button
              size="icon-sm"
              variant="ghost"
              title={openTarget === 'vscode' ? '在 VS Code 中打开' : '在默认应用中打开'}
              aria-label={openTarget === 'vscode' ? '在 VS Code 中打开' : '在默认应用中打开'}
              onClick={openExternally}
            >
              {openTarget === 'vscode' ? <Code /> : <ExternalLink />}
            </Button>
          )}
          {editable && (
            <Button
              size="icon-sm"
              variant="ghost"
              title={
                draft.saving ? '保存中…' : draft.text === draft.saved ? '已保存' : '保存 (Ctrl+S)'
              }
              aria-label="保存笔记"
              disabled={draft.saving || !dirty}
              onClick={() => run(useWorkspace.getState().save(documentKey))}
            >
              <Save />
            </Button>
          )}
          {sourceId && (
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
          {editable && markdown && !forcedSource && (
            <Button
              size="icon-sm"
              variant={effectiveMode === 'source' ? 'secondary' : 'ghost'}
              title={effectiveMode === 'source' ? '返回所见即所得' : '源码模式'}
              aria-label={effectiveMode === 'source' ? '返回所见即所得' : '源码模式'}
              aria-pressed={effectiveMode === 'source'}
              onClick={() => changeMode(effectiveMode === 'source' ? 'rich' : 'source')}
            >
              <Code />
            </Button>
          )}
          {(entry?.kind === 'local' || entry?.kind === 'imported') && markdown && (
            <Button
              size="icon-sm"
              variant="ghost"
              title="创建可编辑副本"
              aria-label="创建可编辑副本"
              onClick={createCopy}
            >
              <CopyPlus />
            </Button>
          )}
          {(entry?.kind === 'local' || entry?.kind === 'imported' || entry?.kind === 'note') && (
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
              // 有未保存草稿时先经应用内确认（与移除内容等危险操作一致），不用系统原生弹窗。
              if (draft.text === draft.saved) run(useWorkspace.getState().read(documentKey, true));
              else setConfirmReload(true);
            }}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>
      {(error || draft.error) && (
        <div
          role="alert"
          className="shrink-0 break-words border-b px-4 py-2 text-xs text-destructive"
        >
          {error ?? draft.error}
          {draft.error && (
            <button className="ml-3 underline" onClick={() => onNewNote(draft.text)}>
              另存为新笔记
            </button>
          )}
        </div>
      )}
      {editable && forcedSource && (
        <p className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
          此笔记包含暂不支持所见即所得的语法（frontmatter），已停在源码模式，内容将原样保存。
        </p>
      )}
      {notice && (
        <p role="status" className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {isNote && markdown && effectiveMode !== 'source' ? (
        <NoteEditor
          value={draft.text}
          documentKey={documentKey}
          editorStateKey={`note:${documentKey}:${viewId}`}
          readOnly={!editable || effectiveMode === 'read'}
          autoFocus={editable && draft.text === ''}
          onChange={(text) => useWorkspace.getState().edit(documentKey, text)}
          onSave={() => void useWorkspace.getState().save(documentKey)}
        />
      ) : isNote ? (
        <MarkdownEditor
          value={draft.text}
          filename={entry?.name ?? undefined}
          editorStateKey={`document:${documentKey}:${viewId}`}
          readOnly={!editable}
          scroll={scroll}
          onChange={(text) => useWorkspace.getState().edit(documentKey, text)}
          onSave={() => void useWorkspace.getState().save(documentKey)}
          onScroll={onScroll}
        />
      ) : shuiyuanTopicId !== null ? (
        <ShuiyuanSourceDoc
          content={draft.content}
          onOpenInShuiyuan={(topicId, postNumber) => onOpenShuiyuanTopic?.(topicId, postNumber)}
          onOpenUrl={link}
          text={draft.text}
          topicId={shuiyuanTopicId}
        />
      ) : (entry?.kind === 'local' || entry?.kind === 'imported') &&
        draft.content.format === 'text' ? (
        /* 代码/文本文件：只读 CodeMirror（语法高亮、原生复制与搜索）。 */
        <MarkdownEditor
          value={draft.text ?? ''}
          filename={entry.name}
          editorStateKey={`document:${documentKey}:${viewId}`}
          readOnly
          saveOnBlur={false}
          scroll={scroll}
          onChange={() => {}}
          onSave={() => {}}
          onScroll={onScroll}
        />
      ) : (
        <SourceDetail
          content={draft.content}
          text={draft.text}
          onLink={link}
          scroll={scroll}
          onScroll={onScroll}
          resolveImage={
            (entry?.kind === 'local' || entry?.kind === 'imported') && entry
              ? resolveImage
              : undefined
          }
        />
      )}
      <Dialog.Root onOpenChange={setConfirmReload} open={confirmReload}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
            <Dialog.Title className="text-base font-semibold">重新载入</Dialog.Title>
            <Dialog.Description className="mt-2 text-xs text-muted-foreground">
              重新载入会抛弃当前未保存的草稿，是否继续？
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirmReload(false)} variant="ghost">
                取消
              </Button>
              <Button
                onClick={() => {
                  setConfirmReload(false);
                  run(useWorkspace.getState().read(documentKey, true));
                }}
                variant="destructive"
              >
                重新载入
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
