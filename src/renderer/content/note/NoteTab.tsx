import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import type { TabId } from '../../../shared/layout';
import { decodeAssetPath, isRelativeAssetPath, noteAssetUrl } from '../../../shared/note-files';
import { DocumentToolbar, type NoteMode } from './document-toolbar';
import { useNoteDraftSource } from './draft-source';
import { MarkdownEditor } from './MarkdownEditor';
import { markdownImageInsert } from './live-preview';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';

/** Markdown 文件的图片粘贴/拖入：落盘到同目录 assets/，插入相对路径引用。 */
const imageInsert = (entryId: string) =>
  markdownImageInsert(
    async (file) => {
      if (!window.dela) throw new Error('仅桌面应用支持插入本地图片');
      return window.dela.workspace.saveNoteImage(
        entryId,
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
    },
    (cause) =>
      showToast({ variant: 'error', title: '插入图片失败', description: errorText(cause) }),
  );

export function parseNoteTabId(tabId: string): string | null {
  if (!tabId.startsWith('note:')) return null;
  const entryId = tabId.slice('note:'.length);
  return entryId || null;
}

/* 编辑模式按文件在本次会话内记忆。 */
const noteModes = new Map<string, NoteMode>();
/* 滚动位置按 标签+组 记忆，不持久化。 */
const scrollMemory = new Map<string, number>();

/**
 * 本地文本文件的编辑标签：草稿经注入的 NoteDraftSource 读写。Markdown 默认即时渲染（光标所在行显示原文），
 * 可切到纯源码；其余文本按语言高亮。编辑器只把用户改的字节写回去，不做任何格式化。
 */
export function NoteTab({ tabId, groupId }: { tabId: TabId; groupId: string }) {
  const entryId = parseNoteTabId(tabId);
  const scrollKey = `${tabId}:${groupId}`;
  const source = useNoteDraftSource();
  const draft = entryId !== null ? source.useDraft(entryId) : undefined;
  const path = source.usePath?.(entryId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const [mode, setMode] = useState<NoteMode>(() =>
    entryId !== null ? (noteModes.get(entryId) ?? 'live') : 'live',
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (entryId === null) return;
    let active = true;
    setError(null);
    const refresh = (force: boolean) => {
      const current = draftRef.current;
      // 有未保存修改或保存进行中时不刷新，避免覆盖编辑。
      if (current && (current.saving || current.text !== current.saved)) return;
      void source.acquire(entryId, force).catch((cause) => {
        if (active) setError(errorText(cause));
      });
    };
    refresh(false);
    // 笔记文件可能被外部编辑：窗口聚焦时强制重读（同样不覆盖未保存草稿）。
    const refreshLocal = () => refresh(true);
    window.addEventListener('focus', refreshLocal);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshLocal);
      // 卸载即释放引用：草稿先冲盘，最后一个引用才移除（note/drafts 语义）。
      void source.release(entryId);
    };
  }, [entryId, source]);

  if (entryId === null)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-13 text-ink-3">
        无效的笔记标签：{tabId}
      </div>
    );
  if (!draft)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-13 text-ink-3">
        {error ? (
          <div role="alert" className="min-w-0">
            <p className="break-words">{error}</p>
            <Button
              variant="ghost"
              onClick={() => {
                setError(null);
                void source.acquire(entryId, true).catch((cause) => setError(errorText(cause)));
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

  if (draft.content.format !== 'markdown' && draft.content.format !== 'text')
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-13 text-ink-3">
        <p>“{draft.content.title}”不是 UTF-8 文本，或超过 50 MB，无法在应用内打开。</p>
        <Button
          variant="secondary"
          onClick={() =>
            void window.dela?.workspace
              .openFile(entryId)
              .catch((cause) =>
                showToast({ variant: 'error', title: '打开失败', description: errorText(cause) }),
              )
          }
        >
          用默认程序打开
        </Button>
      </div>
    );
  const markdown = draft.content.format === 'markdown';
  const readOnly = draft.content.readOnly === true;
  const changeMode = (next: NoteMode) => {
    noteModes.set(entryId, next);
    setMode(next);
  };
  const dirty = draft.text !== draft.saved;
  const runReload = () => {
    setError(null);
    void source.acquire(entryId, true).catch((cause) => setError(errorText(cause)));
  };
  /* 定位入口交给系统文件管理器。 */
  const openInFolder = () => {
    if (window.dela)
      void window.dela.workspace.openLocal(entryId).catch((cause) =>
        showToast({
          variant: 'error',
          title: '打开所在文件夹失败',
          description: errorText(cause),
        }),
      );
  };

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={`文件：${draft.content.title}`}
    >
      <DocumentToolbar
        path={path?.length ? path : [draft.content.title]}
        markdown={markdown}
        mode={mode}
        onModeChange={changeMode}
        saving={draft.saving}
        dirty={dirty}
        failed={draft.error !== null || error !== null}
        dueAt={draft.content.dueAt}
        onOpenInFolder={openInFolder}
        onReload={() => {
          // 有未保存草稿时先经应用内确认（与移除内容等危险操作一致），不用系统原生弹窗。
          if (dirty) setConfirmReload(true);
          else runReload();
        }}
      />
      {(error || draft.error) && (
        <div role="alert" className="shrink-0 break-words border-b px-4 py-2 text-xs text-red">
          {error ?? draft.error}
          {error && (
            <button className="ml-3 underline" onClick={runReload}>
              重试
            </button>
          )}
          {draft.error && (
            <>
              <button className="ml-3 underline" onClick={() => void source.save(entryId)}>
                重试保存
              </button>
              {source.saveAsNewNote && (
                <button
                  className="ml-3 underline"
                  onClick={() => source.saveAsNewNote?.(entryId, draft.text)}
                >
                  另存为新笔记
                </button>
              )}
            </>
          )}
        </div>
      )}
      {draft.content.truncated && (
        <p className="shrink-0 border-b px-4 py-2 text-xs text-ink-3">
          文件超过 1 MB，这里只读显示开头部分。要编辑完整内容请用外部编辑器打开。
        </p>
      )}
      {/* 模式切换换一个编辑器实例（key 不同）：即时渲染与源码各自保留撤销历史与光标。 */}
      <MarkdownEditor
        key={markdown ? mode : 'code'}
        value={draft.text}
        filename={draft.content.title}
        editorStateKey={`document:${entryId}:${groupId}:${markdown ? mode : 'code'}`}
        scroll={scrollMemory.get(scrollKey) ?? 0}
        readOnly={readOnly}
        livePreview={
          markdown && mode === 'live'
            ? (src) =>
                isRelativeAssetPath(src) ? noteAssetUrl(entryId, decodeAssetPath(src)) : src
            : undefined
        }
        extensions={markdown && !readOnly ? [imageInsert(entryId)] : []}
        onChange={(text) => source.edit(entryId, text)}
        onSave={() => void source.save(entryId)}
        onScroll={(top) => scrollMemory.set(scrollKey, top)}
      />
      <Dialog.Root onOpenChange={setConfirmReload} open={confirmReload}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogOverlay} />
          <Dialog.Content className={cn(dialogPanel, 'max-w-md')}>
            <Dialog.Title className="text-base font-semibold">重新载入</Dialog.Title>
            <Dialog.Description className="mt-2 text-xs text-ink-3">
              重新载入会抛弃当前未保存的草稿，是否继续？
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirmReload(false)} variant="ghost">
                取消
              </Button>
              <Button
                onClick={() => {
                  setConfirmReload(false);
                  runReload();
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
