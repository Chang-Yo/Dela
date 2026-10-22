import { useEffect, useState } from 'react';
import { Folder } from 'lucide-react';
import type { WorkspacePrefs } from '../../../../shared/api';
import type { WorkbenchLayout } from '../../../../shared/layout';
import { Button } from '../../../components/ui/button';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { SettingsGroup } from '../SettingsGroup';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { useNoteSpellcheck } from '../../../content/note/note-spellcheck';
import { errorText, useWorkspaceStore } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
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

/** 设置 › 工作区：工作目录、启动恢复、默认笔记编辑方式、笔记拼写检查、当前项目布局重置与隐藏项目恢复。 */
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
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    try {
      const saved = window.dela
        ? await window.dela.settings.setWorkspacePrefs(patch)
        : { ...prefs, ...patch };
      setPrefs(saved);
      // 已挂载的笔记编辑器读这个镜像：保存确认后再改，失败时不留下与磁盘不一致的状态。
      if (patch.noteSpellcheck !== undefined)
        useNoteSpellcheck.getState().setSpellcheck(saved.noteSpellcheck);
    } catch (cause) {
      setPrefs(previous);
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const chooseDirectory = () => {
    void window.dela?.workspace
      .chooseDirectory()
      .then(() => useWorkspaceStore.getState().refresh())
      .catch((cause) =>
        showToast({ variant: 'error', title: '选择目录失败', description: errorText(cause) }),
      );
  };

  // 重置 = 把当前项目布局写回默认单组：下次进入该项目（或重启）时生效。
  const resetLayout = async () => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      await window.dela.layout.save(currentProjectId(), defaultLayout);
      setResetConfirm(false);
      showToast({ variant: 'success', title: '布局已重置', description: '下次进入该项目时生效。' });
    } catch (cause) {
      showToast({ variant: 'error', title: '重置失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-10">
      <SectionHeader title="工作区" />
      {error && (
        <p className="text-xs text-red" role="alert">
          {error}
        </p>
      )}
      <SettingsGroup>
        {/* 不迁移已有文件：改目录后旧笔记「消失」是用户最常见的误解，必须保留警示。 */}
        <SettingRow
          description="仅影响之后新建的内容，不迁移已有文件。"
          settingId="work-directory"
          title="工作目录"
        >
          <div className="flex items-center justify-end gap-3">
            <span className="truncate text-xs text-ink-3" title={directory || undefined}>
              {directory || '未选择'}
            </span>
            <Button onClick={chooseDirectory} size="sm" variant="secondary">
              <Folder />
              选择
            </Button>
          </div>
        </SettingRow>
        <SettingRow
          description="即时渲染与源码模式共用；关闭后不显示拼写波浪线。"
          settingId="note-spellcheck"
          title="笔记拼写检查"
        >
          <Switch
            checked={prefs?.noteSpellcheck ?? false}
            disabled={prefs === null || busy}
            label="笔记拼写检查"
            onChange={(value) => void changePrefs({ noteSpellcheck: value })}
          />
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
                }}
                size="sm"
                variant="secondary"
              >
                重置当前项目布局
              </Button>
            )}
          </div>
        </SettingRow>
        {/* 隐藏只收起导航入口，项目文件与会话都还在；此处提供恢复。 */}
        {hiddenProjects.length > 0 && (
          <SettingRow settingId="hidden-projects" title="已隐藏项目">
            <div className="grid content-start gap-2">
              {hiddenProjects.map((project) => (
                <div className="flex items-center gap-3" key={project.id}>
                  <span className="min-w-0 flex-1 truncate text-13">{project.name}</span>
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
      </SettingsGroup>
    </div>
  );
}
