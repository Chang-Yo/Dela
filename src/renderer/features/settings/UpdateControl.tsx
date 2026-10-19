import { ExternalLink } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { DownloadProgressRow } from '../../components/download-progress';
import { SettingRow } from './SettingRow';
import { SettingsGroup } from './SettingsGroup';
import { useUpdateState, runUpdateAction, updateView } from './update';

/**
 * 通用 › 软件更新。状态由主进程持有、经 update:state 广播，这里只读共享 store（标题栏提示读同一份）
 * 并派发动作；页面卸载不打断下载，重进设置页立刻看到进度。浏览器预览没有 preload，state 为空时不渲染。
 */
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
            // 下载与安装是这一页真正的主操作，用主色；其余（检查、重试、下载安装包）用
            // secondary，与「暂停通知」的 30 分钟按钮同一档——ghost 没有底色，看不出能点。
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
