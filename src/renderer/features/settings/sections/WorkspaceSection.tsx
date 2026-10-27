import { useState } from 'react';
import { Folder } from 'lucide-react';
import type { WorkbenchLayout } from '../../../../shared/layout';
import { Button } from '../../../components/ui/button';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { SettingsGroup } from '../SettingsGroup';
import { errorText, useWorkspaceStore } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';

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

/** 设置 › 工作区：工作目录与当前项目布局重置。 */
export function WorkspaceSection() {
  const directory = useWorkspaceStore((state) => state.workspace.directory);
  const [busy, setBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

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
      <SettingsGroup>
        <SettingRow settingId="work-directory" title="工作目录">
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
      </SettingsGroup>
    </div>
  );
}
