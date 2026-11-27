import { useEffect, useEffectEvent, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../../../../ui/button';
import { Kbd } from '../../../../ui/kbd';
import {
  acceleratorFromEvent,
  acceleratorKeys,
  findShortcutConflicts,
  isDigitFamily,
  shortcutActions,
  shortcutGroups,
  type ShortcutActionId,
} from '../../../../modules/settings/contract';
import { useShortcuts } from '../../shell/shortcuts';
import { SectionHeader, SettingsGroup } from '../../../../modules/settings/view';
import { showToast } from '../../../../ui/toast';
import { ErrorText } from '../../../../ui/error-text';
import { errorMessage } from '../../../../core/protocol/contract';

const platform = window.dela?.platform === 'darwin' ? 'mac' : 'other';

function acceleratorText(accelerator: string | null, family?: 'digit'): string {
  if (!accelerator) return '未绑定';
  return acceleratorKeys(accelerator, platform, family).join(' + ');
}

export function ShortcutsSection() {
  const bindings = useShortcuts((state) => state.bindings);
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (id: ShortcutActionId, accelerator: string | null) => {
    if (busy) return;
    const conflict = findShortcutConflicts({ ...bindings, [id]: accelerator }).find((item) =>
      item.actionIds.includes(id),
    );
    if (conflict) {
      const owner = shortcutActions.find(
        (item) => item.id !== id && conflict.actionIds.includes(item.id),
      )!;
      setError(
        `${acceleratorText(conflict.accelerator)} 已被「${owner.label}」占用，请换一个组合。`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    const failureTitle =
      shortcutActions.find((item) => item.id === id)?.defaultKeys === accelerator
        ? '恢复默认失败'
        : '保存快捷键失败';
    try {
      await useShortcuts.getState().setBinding(id, accelerator);
      setRecording(null);
    } catch (cause) {
      showToast({
        variant: 'error',
        title: failureTitle,
        description: errorMessage(cause),
      });
    }
    setBusy(false);
  };

  const recordKey = useEffectEvent((event: KeyboardEvent) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecording(null);
      setError(null);
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      void apply(recording, null);
      return;
    }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
    const accelerator = acceleratorFromEvent(event, platform);
    if (!accelerator) return;
    const action = shortcutActions.find((item) => item.id === recording);
    if (action?.family === 'digit' && !isDigitFamily(accelerator)) {
      setError('该快捷键作用于第 N 个工作组，需要以数字 1…9 结尾。');
      return;
    }
    void apply(recording, accelerator);
  });

  // 录制：捕获阶段抢在 AppShell 的窗口级派发之前消费按键，避免边录制边触发动作。
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => recordKey(event);
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording]);

  const conflicts = findShortcutConflicts(bindings);

  return (
    <div className="grid gap-10" data-setting-id="shortcuts">
      <SectionHeader
        title="快捷键"
        action={
          <Button
            disabled={busy}
            onClick={() => {
              setError(null);
              setBusy(true);
              void useShortcuts
                .getState()
                .resetAll()
                .catch((cause) =>
                  showToast({
                    variant: 'error',
                    title: '恢复默认失败',
                    description: errorMessage(cause),
                  }),
                )
                .finally(() => setBusy(false));
            }}
            size="sm"
            variant="secondary"
          >
            全部恢复默认
          </Button>
        }
      />
      {error && <ErrorText>{error}</ErrorText>}
      {conflicts.length > 0 && (
        <p className="text-xs text-warning" role="status">
          {conflicts
            .map((conflict) => {
              const labels = conflict.actionIds
                .map((id) => shortcutActions.find((item) => item.id === id)?.label ?? id)
                .join('、');
              const action = shortcutActions.find((item) => item.id === conflict.actionIds[0]);
              return `${acceleratorText(conflict.accelerator, action?.family)} 被「${labels}」共用`;
            })
            .join('；')}
        </p>
      )}
      {shortcutGroups().map((group) => (
        <SettingsGroup key={group.title} title={group.title}>
          {group.actions.map((action) => {
            const accelerator = bindings[action.id];
            const isRecording = recording === action.id;
            return (
              <div
                className="flex items-center justify-between gap-3 border-b py-3 last:border-0"
                data-setting-id={`shortcut-${action.id}`}
                key={action.id}
              >
                <span className="min-w-0 truncate text-sm">{action.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    aria-label={`修改「${action.label}」的快捷键`}
                    className="rounded-control px-1 py-0.5 transition-colors hover:bg-hover"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setRecording(isRecording ? null : action.id);
                    }}
                    type="button"
                  >
                    {isRecording ? (
                      <span className="text-xs text-ink-3">按下新的按键…</span>
                    ) : accelerator ? (
                      <span className="flex items-center gap-1">
                        {acceleratorKeys(accelerator, platform, action.family).map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-3">未绑定</span>
                    )}
                  </button>
                  {accelerator !== action.defaultKeys ? (
                    <Button
                      aria-label={`恢复「${action.label}」的默认快捷键`}
                      disabled={busy}
                      onClick={() => void apply(action.id, action.defaultKeys)}
                      size="icon-xs"
                      title="恢复默认"
                      variant="ghost"
                    >
                      <RotateCcw />
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </SettingsGroup>
      ))}
    </div>
  );
}
