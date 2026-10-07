import { useEffect, useState } from 'react';
import { Folder } from 'lucide-react';
import type { NoteEditModePreference, WorkspacePrefs } from '../../../../shared/api';
import type { WorkbenchLayout } from '../../../../shared/layout';
import { Button } from '../../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { errorText, useWorkspaceStore } from '../../../workspace/store';
import { useProjectNavPrefs } from '../../../navigation/store';

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

/** 设置 › 工作区：工作目录、启动恢复、默认笔记编辑方式、当前项目布局重置与隐藏项目恢复。 */
export function WorkspaceSection() {
  const directory = useWorkspaceStore((state) => state.workspace.directory);
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const projectPrefs = useProjectNavPrefs((state) => state.projects);
  const setProject = useProjectNavPrefs((state) => state.setProject);
  const hiddenProjects = entries.filter(
    (entry) => entry.kind === 'project' && projectPrefs[entry.id]?.hidden,
  );
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
      <SectionHeader title="工作区" />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <section className="grid gap-5">
        {/* 不迁移已有文件：改目录后旧笔记「消失」是用户最常见的误解，必须保留警示。 */}
        <SettingRow
          description="仅影响之后新建的内容，不迁移已有文件。"
          settingId="work-directory"
          title="工作目录"
        >
          <div className="flex items-center justify-end gap-3">
            <span className="truncate text-xs text-muted-foreground" title={directory || undefined}>
              {directory || '未选择'}
            </span>
            <Button onClick={chooseDirectory} size="sm" variant="secondary">
              <Folder />
              选择
            </Button>
          </div>
        </SettingRow>
        {/* frontmatter 强制源码：防止用户以为模式切换入口丢失。 */}
        <SettingRow
          description="含 frontmatter 等语法的笔记始终以源码模式打开。"
          settingId="note-edit-mode"
          title="默认笔记编辑方式"
        >
          <div className="flex items-center justify-end">
            <Select
              disabled={prefs === null || busy}
              onValueChange={(value) =>
                void changePrefs({ defaultNoteEditMode: value as NoteEditModePreference })
              }
              value={prefs?.defaultNoteEditMode ?? 'rich'}
            >
              <SelectTrigger aria-label="默认笔记编辑方式" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(editModeLabels) as NoteEditModePreference[]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {editModeLabels[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SettingRow>
        <SettingRow settingId="reset-layout" title="布局重置">
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
        </SettingRow>
        {/* 隐藏只收起导航入口，项目文件与会话都还在；此处提供恢复。 */}
        {hiddenProjects.length > 0 && (
          <SettingRow settingId="hidden-projects" title="已隐藏项目">
            <div className="grid content-start gap-2">
              {hiddenProjects.map((project) => (
                <div className="flex items-center gap-3" key={project.id}>
                  <span className="min-w-0 flex-1 truncate text-sm">{project.name}</span>
                  <Button
                    onClick={() => setProject(project.id, { hidden: false })}
                    size="sm"
                    variant="secondary"
                  >
                    恢复入口
                  </Button>
                </div>
              ))}
            </div>
          </SettingRow>
        )}
      </section>
    </div>
  );
}
