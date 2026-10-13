import { ExternalLink } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { SettingRow } from './SettingRow';
import { SettingsGroup } from './SettingsGroup';
import { useUpdateState } from './update-state';
import { runUpdateAction } from './update-commands';
import { updateView } from './updateView';

function downloadSpeed(bytes: number | null): string {
  if (bytes === null) return '计算中…';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytes)} B/s`;
}

/**
 * 通用 › 软件更新。
 *
 * 状态由主进程持有、经 update:state 广播，这里只读共享 store（标题栏提示读的是同一份）
 * 并派发动作：页面卸载不会打断进行中的下载，重新进入设置页也能立刻看到当前进度。
 * 浏览器预览没有 preload，此时整块不渲染。
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
          <div className="flex items-center gap-2 text-[12px] tabular-nums text-ink-3">
            <span className="w-20 shrink-0 whitespace-nowrap">
              {downloadSpeed(state.bytesPerSecond)}
            </span>
            <div
              aria-label="更新下载进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(view.progress * 100)}
              className="h-1 w-40 overflow-hidden rounded-full bg-line"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-ink-2 transition-[width] duration-300 ease-out"
                style={{ width: `${Math.round(view.progress * 100)}%` }}
              />
            </div>
            <span aria-hidden="true" className="w-10 shrink-0 text-right">
              {Math.round(view.progress * 100)}%
            </span>
          </div>
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
