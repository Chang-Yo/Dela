import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import type { TabId } from '../../../shared/layout';
import { markdownRequiresSourceMode } from '../../../shared/note-files';
import { DocumentToolbar, type NoteMode } from './document-toolbar';
import { getDefaultNoteEditMode } from './default-mode';
import { useNoteDraftSource } from './draft-source';
import { MarkdownEditor } from './MarkdownEditor';
import { NoteEditor } from './NoteEditor';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';

/** 解析 note:{entryId} 标签键；无效载荷返回 null。 */
export function parseNoteTabId(tabId: string): string | null {
  if (!tabId.startsWith('note:')) return null;
  const entryId = tabId.slice('note:'.length);
  return entryId || null;
}

/* 编辑模式按笔记在本次会话内记忆（原 ProjectDocument 的模块级 noteModes）。 */
const noteModes = new Map<string, NoteMode>();
/* 源码模式滚动位置按 标签+组 记忆（PreviewTab.scrollMemory 同款内存 Map，不持久化）。 */
const scrollMemory = new Map<string, number>();

/**
 * 笔记标签内容：ProjectDocument 笔记分支的承接者。草稿经注入的 NoteDraftSource
 * 读写（3B 由 note/drafts 接线），编辑/阅读/源码模式切换与自动保存状态展示在此。
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
    entryId !== null
      ? (noteModes.get(entryId) ?? getDefaultNoteEditMode())
      : getDefaultNoteEditMode(),
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (entryId === null) return;
    let active = true;
    setError(null);
    const refresh = (force: boolean) => {
      const current = draftRef.current;
      // 有未保存修改或保存进行中时不刷新，避免覆盖编辑（旧 ProjectDocument 同款守卫）。
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
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-[13px] text-ink-3">
        无效的笔记标签：{tabId}
      </div>
    );
  if (!draft)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-[13px] text-ink-3">
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

  const markdown = draft.content.format === 'markdown';
  // frontmatter 等会被所见即所得内核破坏的语法：整篇停留源码模式。
  const forcedSource = markdown && markdownRequiresSourceMode(draft.text);
  const effectiveMode: NoteMode = forcedSource ? 'source' : mode;
  const changeMode = (next: NoteMode) => {
    noteModes.set(entryId, next);
    setMode(next);
  };
  const dirty = draft.text !== draft.saved;
  const runReload = () => {
    setError(null);
    void source.acquire(entryId, true).catch((cause) => setError(errorText(cause)));
  };
  /* 笔记文件由应用管理：定位入口交给系统文件管理器。 */
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
      aria-label={`笔记：${draft.content.title}`}
    >
      <DocumentToolbar
        path={path?.length ? path : [draft.content.title]}
        markdown={markdown}
        forcedSource={forcedSource}
        mode={effectiveMode}
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
        <div role="alert" className="shrink-0 break-words border-b px-4 py-2 text-[12px] text-red">
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
      {forcedSource && (
        <p className="shrink-0 border-b px-4 py-2 text-[12px] text-ink-3">
          此笔记包含暂不支持所见即所得的语法（frontmatter），已停在源码模式，内容将原样保存。
        </p>
      )}
      {markdown && effectiveMode !== 'source' ? (
        <NoteEditor
          value={draft.text}
          documentKey={entryId}
          editorStateKey={`note:${entryId}:${groupId}`}
          readOnly={effectiveMode === 'read'}
          autoFocus={draft.text === ''}
          onChange={(text) => source.edit(entryId, text)}
          onSave={() => void source.save(entryId)}
        />
      ) : (
        <MarkdownEditor
          value={draft.text}
          filename={draft.content.title}
          editorStateKey={`document:${entryId}:${groupId}`}
          scroll={scrollMemory.get(scrollKey) ?? 0}
          onChange={(text) => source.edit(entryId, text)}
          onSave={() => void source.save(entryId)}
          onScroll={(top) => scrollMemory.set(scrollKey, top)}
        />
      )}
      <Dialog.Root onOpenChange={setConfirmReload} open={confirmReload}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogOverlay} />
          <Dialog.Content className={cn(dialogPanel, 'max-w-md')}>
            <Dialog.Title className="text-base font-semibold">重新载入</Dialog.Title>
            <Dialog.Description className="mt-2 text-[12px] text-ink-3">
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
