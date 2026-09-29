import { useEffect, useState } from 'react';
import { Folder } from 'lucide-react';
import type { NoteEditModePreference, WorkspacePrefs } from '../../../../shared/api';
import type { WorkbenchLayout } from '../../../../shared/layout';
import { Button } from '../../../components/ui/button';
import { Switch } from '../../../components/ui/switch';
import { SectionHeader } from '../SectionHeader';
import { errorText, useWorkspaceStore } from '../../../workspace/store';

/** 重置后的默认布局：单组空标签（workbench 的 createDefaultLayout 同构）。 */
const defaultLayout: WorkbenchLayout = {
  root: { type: 'group', id: 'primary', tabs: [], active: null },
  focus: 'primary',
  maximized: null,
};

/** 当前项目 id：与 App 导航一致的 localStorage 键；空串表示无项目（通用布局）。 */
function currentProjectId(): string | null {
  const raw =
    typeof localStorage === 'undefined' ? null : localStorage.getItem('dela.workspace.project');
  return raw ? raw : null;
}

const editModeLabels: Record<NoteEditModePreference, string> = {
  rich: '所见即所得',
  source: 'Markdown 源码',
};

/** 设置 › 工作区：工作目录、启动恢复、默认笔记编辑方式与当前项目布局重置。 */
export function WorkspaceSection() {
  const directory = useWorkspaceStore((state) => state.workspace.directory);
  // null 表示尚未读到当前状态，控件保持禁用避免闪烁出错误的默认值。
  const [prefs, setPrefs] = useState<WorkspacePrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.dela?.settings
      .getWorkspacePrefs()
      .then(setPrefs)
      .catch((cause) => setError(errorText(cause)));
  }, []);

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化。
  const changePrefs = async (patch: Partial<WorkspacePrefs>) => {
    if (busy || prefs === null) return;
    setBusy(true);
    setError(null);
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    try {
      setPrefs(
        window.dela ? await window.dela.settings.setWorkspacePrefs(patch) : { ...prefs, ...patch },
      );
    } catch (cause) {
      setPrefs(previous);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const chooseDirectory = () => {
    void window.dela?.workspace
      .chooseDirectory()
      .then(() => useWorkspaceStore.getState().refresh())
      .catch((cause) => setError(errorText(cause)));
  };

  // 重置 = 把当前项目布局写回默认单组：下次进入该项目（或重启）时生效。
  const resetLayout = async () => {
    if (!window.dela || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.dela.layout.save(currentProjectId(), defaultLayout);
      setResetConfirm(false);
      setResetDone(true);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <SectionHeader description="工作目录、启动恢复与布局。" title="工作区" />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="work-directory"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">工作目录</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            保存笔记与生成文件的位置；只影响之后新建的顶层内容和课程文件，不迁移已有文件。
          </p>
        </div>
        <div className="flex items-center justify-end gap-3">
          <span className="truncate text-xs text-muted-foreground" title={directory || undefined}>
            {directory || '未选择'}
          </span>
          <Button onClick={chooseDirectory} size="sm" variant="secondary">
            <Folder />
            选择
          </Button>
        </div>
      </section>
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="restore-last"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">启动恢复</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            启动时恢复上次打开的项目与标签布局；不自动继续未完成的任务。
          </p>
        </div>
        <div className="flex items-center justify-end">
          <Switch
            checked={prefs?.restoreLastProject ?? true}
            disabled={prefs === null || busy}
            label="启动时恢复上次项目与标签"
            onChange={(next) => void changePrefs({ restoreLastProject: next })}
          />
        </div>
      </section>
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="note-edit-mode"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">默认笔记编辑方式</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            打开 Markdown 笔记时进入的编辑方式；含 frontmatter 等语法的笔记始终停在源码模式。
          </p>
        </div>
        <div className="flex items-center justify-end">
          <select
            aria-label="默认笔记编辑方式"
            className="h-9 w-32 rounded-md border bg-background px-3 text-sm text-foreground"
            disabled={prefs === null || busy}
            onChange={(event) =>
              void changePrefs({
                defaultNoteEditMode: event.target.value as NoteEditModePreference,
              })
            }
            value={prefs?.defaultNoteEditMode ?? 'rich'}
          >
            {(Object.keys(editModeLabels) as NoteEditModePreference[]).map((mode) => (
              <option key={mode} value={mode}>
                {editModeLabels[mode]}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="reset-layout"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">布局重置</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            清除当前项目的分屏与标签布局，恢复为单栏空标签；下次进入该项目或重启后生效。
          </p>
        </div>
        <div className="grid content-start justify-items-end gap-1.5">
          {resetConfirm ? (
            <div className="flex items-center gap-2">
              <Button
                disabled={busy}
                onClick={() => void resetLayout()}
                size="sm"
                variant="destructive"
              >
                确认重置
              </Button>
              <Button onClick={() => setResetConfirm(false)} size="sm" variant="ghost">
                取消
              </Button>
            </div>
          ) : (
            <Button
              disabled={busy || !window.dela}
              onClick={() => {
                setResetConfirm(true);
                setResetDone(false);
              }}
              size="sm"
              variant="secondary"
            >
              重置当前项目布局
            </Button>
          )}
          {resetDone ? (
            <p className="text-xs text-muted-foreground" role="status">
              已重置，下次进入该项目时生效。
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
