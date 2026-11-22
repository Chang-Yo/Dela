import { useEffect, useState } from 'react';

import { Button } from '../../../ui/button';
import { showToast } from '../../../ui/toast';
import { parseRemoteNodeId, type WorkspaceEntry } from '../../workspace/contract';
import { useWorkspaceStore, workspaceClient } from '../../workspace/view';
import { DocumentToolbar } from './document-toolbar';
import { useNoteDraftSource } from './draft-source';
import { MarkdownEditor } from './MarkdownEditor';
import {
  noteScrollOf,
  rememberNoteMode,
  rememberNoteScroll,
  useNoteViewMemory,
} from './view-memory';
import { useNoteDrafts } from './drafts';
import { markdownImageInsert } from './live-preview';
import { Spinner } from '../../../ui/spinner';
import { ConfirmDialog } from '../../../ui/dialog';
import { errorMessage } from '../../../core/protocol/contract';
import type { TabId } from '../../../core/protocol/workbench';
import { InlineButton } from '../../../ui/inline-button';

const imageInsert = (entryId: string) =>
  markdownImageInsert(
    async (file) => {
      if (!window.dela) throw new Error('仅桌面应用支持插入本地图片');
      return workspaceClient.saveNoteImage({
        id: entryId,
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    },
    (cause) =>
      showToast({ variant: 'error', title: '插入图片失败', description: errorMessage(cause) }),
  );

function entryPath(entries: WorkspaceEntry[], id: string): string[] {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return [];
  return entry.parentId ? [...entryPath(entries, entry.parentId), entry.name] : [entry.name];
}

export function parseNoteTabId(tabId: string): string | null {
  if (!tabId.startsWith('note:')) return null;
  const entryId = tabId.slice('note:'.length);
  return entryId || null;
}

/** 草稿经注入的 NoteDraftSource 读写；编辑器只把用户改的字节写回去，不做格式化。 */
export function NoteTab({ tabId, groupId }: { tabId: TabId; groupId: string }) {
  const entryId = parseNoteTabId(tabId);
  const scrollKey = `${tabId}:${groupId}`;
  const source = useNoteDraftSource();
  const draft = useNoteDrafts((state) => (entryId === null ? undefined : state.drafts[entryId]));
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const [failure, setFailure] = useState<{ entryId: string; message: string } | null>(null);
  const error = failure && failure.entryId === entryId ? failure.message : null;
  const [confirmReload, setConfirmReload] = useState(false);
  const mode = useNoteViewMemory((state) => state.modes[entryId ?? ''] ?? 'live');
  const reload = (id: string) => {
    setFailure(null);
    void source
      .acquire(id, true)
      .catch((cause) => setFailure({ entryId: id, message: errorMessage(cause) }));
  };
  const unsaved = draft !== undefined && (draft.saving || draft.text !== draft.saved);

  useEffect(() => {
    if (entryId === null) return;
    void source
      .acquire(entryId)
      .catch((cause) => setFailure({ entryId, message: errorMessage(cause) }));
    return () => void source.release(entryId);
  }, [entryId, source]);

  // 笔记文件可能被外部编辑：窗口聚焦时重读磁盘；有未保存修改时不监听，避免覆盖编辑。
  useEffect(() => {
    if (entryId === null || unsaved) return;
    const refresh = () => reload(entryId);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [entryId, source, unsaved]);

  if (entryId === null)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-sm text-ink-3">
        无效的笔记标签：{tabId}
      </div>
    );
  if (!draft)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-sm text-ink-3">
        {error ? (
          <div role="alert" className="min-w-0">
            <p className="break-words">{error}</p>
            <Button variant="ghost" onClick={() => reload(entryId)}>
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

  if (draft.content.format !== 'markdown' && draft.content.format !== 'text')
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-ink-3">
        <p>“{draft.content.title}”不是 UTF-8 文本，或超过 50 MB，无法在应用内打开。</p>
        <Button
          variant="secondary"
          onClick={() =>
            void workspaceClient.openFile(entryId).catch((cause) =>
              showToast({
                variant: 'error',
                title: '打开失败',
                description: errorMessage(cause),
              }),
            )
          }
        >
          用默认程序打开
        </Button>
      </div>
    );
  const path = entryPath(entries, entryId);
  const markdown = draft.content.format === 'markdown';
  const readOnly = draft.content.readOnly === true;
  const dirty = draft.text !== draft.saved;
  const runReload = () => reload(entryId);
  const openInFolder = () => {
    if (window.dela)
      void workspaceClient.openLocal(entryId).catch((cause) =>
        showToast({
          variant: 'error',
          title: '打开所在文件夹失败',
          description: errorMessage(cause),
        }),
      );
  };

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={`文件：${draft.content.title}`}
    >
      <DocumentToolbar
        path={path.length ? path : [draft.content.title]}
        markdown={markdown}
        mode={mode}
        onModeChange={(next) => rememberNoteMode(entryId, next)}
        saving={draft.saving}
        dirty={dirty}
        failed={draft.error !== null || error !== null}
        dueAt={draft.content.dueAt}
        onOpenInFolder={parseRemoteNodeId(entryId) ? undefined : openInFolder}
        onReload={() => {
          if (dirty) setConfirmReload(true);
          else runReload();
        }}
      />
      {(error || draft.error) && (
        <div role="alert" className="shrink-0 break-words border-b px-4 py-2 text-xs text-danger">
          {error ?? draft.error}
          {error && (
            <InlineButton className="ml-3" onClick={runReload}>
              重试
            </InlineButton>
          )}
          {draft.error && (
            <>
              <InlineButton className="ml-3" onClick={() => void source.save(entryId)}>
                重试保存
              </InlineButton>
              {source.saveAsNewNote && (
                <InlineButton
                  className="ml-3"
                  onClick={() => source.saveAsNewNote?.(entryId, draft.text)}
                >
                  另存为新笔记
                </InlineButton>
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
      <MarkdownEditor
        key={markdown ? mode : 'code'}
        value={draft.text}
        filename={draft.content.title}
        editorStateKey={`document:${entryId}:${groupId}:${markdown ? mode : 'code'}`}
        initialScroll={() => noteScrollOf(scrollKey)}
        readOnly={readOnly}
        livePreview={
          markdown && mode === 'live' ? (src) => source.resolveImage(entryId, src) : undefined
        }
        extensions={markdown && !readOnly ? [imageInsert(entryId)] : []}
        onChange={(text) => source.edit(entryId, text)}
        onSave={() => void source.save(entryId)}
        onScroll={(top) => rememberNoteScroll(scrollKey, top)}
      />
      <ConfirmDialog
        confirmLabel="重新载入"
        description="重新载入会抛弃当前未保存的草稿，是否继续？"
        destructive
        onConfirm={() => {
          setConfirmReload(false);
          runReload();
        }}
        onOpenChange={setConfirmReload}
        open={confirmReload}
        title="重新载入"
      />
    </section>
  );
}
