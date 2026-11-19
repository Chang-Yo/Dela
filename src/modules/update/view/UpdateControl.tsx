import { ExternalLink } from 'lucide-react';
import { Button } from '../../../ui/button';
import { DownloadProgressRow } from '../../../ui/download-progress';
import { SettingRow, SettingsGroup } from '../../settings/view';
import { useUpdateState, runUpdateAction, updateView } from './update';

/** 通用 › 软件更新：只读共享 store 并派发动作；页面卸载不打断下载，重进设置页立刻看到进度。 */
export function UpdateControl() {
  const state = useUpdateState((snapshot) => snapshot.snapshot);

  if (!state) return null;
  const view = updateView(state);
  const action = view.action;

  return (
    <SettingsGroup settingId="app-update">
      <SettingRow
        // 当前版本常驻：只报「已是最新」而不说自己是哪一版，用户没法判断有没有升上去。
        // 第二行才是当前进展，role=status 让读屏在检查与下载途中播报变化。
        description={
          <span className="grid gap-0.5">
            <span>当前版本 {state.currentVersion}</span>
            {view.status ? <span role="status">{view.status}</span> : null}
          </span>
        }
        settingId="check-update"
        title="软件更新"
      >
        {view.progress !== null ? (
          <DownloadProgressRow
            barClassName="w-16 md:w-40"
            label="更新下载进度"
            received={state.transferred}
            total={state.total}
          />
        ) : null}
        {action && view.label ? (
          <Button
            onClick={() => {
              if (action === 'install') useUpdateState.setState({ dismissedVersion: null });
              else void runUpdateAction(action);
            }}
            size="sm"
            // 下载与安装用主色；其余用 secondary，ghost 没有底色看不出能点。
            variant={action === 'download' || action === 'install' ? 'default' : 'secondary'}
          >
            {action === 'open-download' ? <ExternalLink /> : null}
            {view.label}
          </Button>
        ) : null}
      </SettingRow>
    </SettingsGroup>
  );
}
