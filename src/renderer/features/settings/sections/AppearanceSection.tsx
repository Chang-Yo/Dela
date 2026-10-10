import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  fontScaleLevels,
  zoomLevels,
  type FontScalePreference,
  type IconPreference,
  type ThemePreference,
  type ZoomPreference,
} from '../../../../shared/api';
import { cn } from '../../../lib/utils';
import { StepperControl } from '../../../components/ui/stepper';
import blackLogo from '../../../../../assets/Dela_black_bg.svg';
import whiteLogo from '../../../../../assets/Dela_white_bg.svg';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { SettingsGroup } from '../SettingsGroup';

const themes: Array<{ id: ThemePreference; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'system', label: '跟随系统' },
  { id: 'dark', label: '深色' },
];

const icons: Array<{ id: IconPreference; label: string; src: string }> = [
  { id: 'white', label: '白底', src: whiteLogo },
  { id: 'black', label: '黑底', src: blackLogo },
];

// 缩放档位标签直接由档位值换算为百分比，与系统显示缩放的写法一致。
const zoomLabel = (zoom: ZoomPreference) => `${Math.round(zoom * 100)}%`;

const fontScaleLabels: Record<FontScalePreference, string> = {
  0.9: '小',
  1: '默认',
  1.1: '大',
  1.25: '特大',
};

/**
 * 主题卡片的缩略图：面板与三条骨架都取主题 token，靠 `bui-light` / `dark` 把卡片单独切到对应主题，
 * 所以切到深色主题后浅色卡片仍是浅色。「跟随系统」左右各半，一眼看出是两套色。
 */
function ThemePreview({ mode }: { mode: ThemePreference }) {
  const bars = (
    <>
      <span className="h-2 w-[70%] rounded-full bg-ink" />
      <span className="h-2 w-[46%] rounded-full bg-bui-accent" />
      <span className="h-2 w-[58%] rounded-full bg-ink-3" />
    </>
  );
  if (mode === 'system') {
    return (
      <div className="grid grid-cols-2 overflow-hidden rounded-control shadow-hairline">
        <div className="bui-light grid content-center gap-2 bg-surface px-3 py-4">{bars}</div>
        <div className="dark grid content-center gap-2 bg-surface px-3 py-4">{bars}</div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'grid content-center gap-2 rounded-control bg-surface px-3 py-4 shadow-hairline',
        mode === 'dark' ? 'dark' : 'bui-light',
      )}
    >
      {bars}
    </div>
  );
}

// 每个外观选项（主题/图标/缩放/字号）独立的写入状态：互不阻塞，失败提示各归其位。
function useOptionSave(failMessage: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch {
      setError(failMessage);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}

export function AppearanceSection({
  fontScale,
  onFontScaleChange,
  onThemeChange,
  onZoomChange,
  theme,
  zoom,
}: {
  fontScale: FontScalePreference;
  onFontScaleChange: (scale: FontScalePreference) => Promise<void>;
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  onZoomChange: (zoom: ZoomPreference) => Promise<void>;
  theme: ThemePreference;
  zoom: ZoomPreference;
}) {
  const [icon, setIcon] = useState<IconPreference>('white');
  const themeSave = useOptionSave('主题保存失败，请重试。');
  const iconSave = useOptionSave('图标设置保存失败，请重试。');
  const zoomSave = useOptionSave('缩放设置保存失败，请重试。');
  const fontSave = useOptionSave('字号保存失败，请重试。');

  useEffect(() => {
    void window.dela?.settings
      .getIcon()
      .then(setIcon)
      .catch(() => {});
  }, []);

  const selectTheme = (next: ThemePreference) => {
    if (next === theme || themeSave.busy) return;
    void themeSave.save(() => onThemeChange(next));
  };

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化。
  const selectIcon = (next: IconPreference) => {
    if (next === icon || iconSave.busy) return;
    void iconSave.save(async () => {
      setIcon(window.dela ? await window.dela.settings.setIcon(next) : next);
    });
  };

  const selectZoom = (next: ZoomPreference) => {
    if (next === zoom || zoomSave.busy) return;
    void zoomSave.save(() => onZoomChange(next));
  };

  const selectFontScale = (next: FontScalePreference) => {
    if (next === fontScale || fontSave.busy) return;
    void fontSave.save(() => onFontScaleChange(next));
  };

  return (
    <div className="grid gap-10">
      <SectionHeader title="外观" />
      {/* 四个设置项一行一项：标签贴左、控件右对齐同一竖线，分组容器承担边界。 */}
      <SettingsGroup>
        {/* 主题三选一占满整行：缩略图卡片比色块更能说明「切过去长什么样」。 */}
        <div className="grid gap-3 border-b border-line py-3.5" data-setting-id="theme">
          <h3 className="text-[13px] font-medium text-ink">主题</h3>
          {/* 恒三列：窗口最小宽 600px，三张卡片各约 180px 仍是可读缩略图，比堆成三行更好分辨。 */}
          <div aria-label="主题" className="grid grid-cols-3 gap-2" role="group">
            {themes.map(({ id, label }) => (
              <button
                aria-pressed={theme === id}
                className={cn(
                  'relative grid content-start gap-2 rounded-card border p-2 transition-colors',
                  theme === id ? 'border-ink' : 'border-line hover:border-line-strong',
                )}
                disabled={themeSave.busy}
                key={id}
                onClick={() => selectTheme(id)}
                type="button"
              >
                <ThemePreview mode={id} />
                {/* 选中标记贴在缩略图角上：文案不因勾选出现而位移。 */}
                {theme === id ? (
                  <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-ink text-surface">
                    <Check className="size-2.5" strokeWidth={2.5} />
                  </span>
                ) : null}
                <span
                  className={cn(
                    'text-center text-[12px]',
                    theme === id ? 'font-medium text-ink' : 'text-ink-3',
                  )}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
          {themeSave.error && (
            <p className="text-[12px] text-red" role="alert">
              {themeSave.error}
            </p>
          )}
        </div>
        <SettingRow settingId="zoom" title="页面缩放">
          <StepperControl
            canDecrease={zoom > zoomLevels[0]}
            canIncrease={zoom < zoomLevels.at(-1)!}
            display={zoomLabel(zoom)}
            label="页面缩放"
            onStep={(delta) => {
              const next = zoomLevels[zoomLevels.indexOf(zoom) + delta];
              if (next) selectZoom(next);
            }}
          />
          {zoomSave.error && (
            <p className="text-[12px] text-red" role="alert">
              {zoomSave.error}
            </p>
          )}
        </SettingRow>
        <SettingRow settingId="font-scale" title="字号">
          <StepperControl
            canDecrease={fontScale > fontScaleLevels[0]}
            canIncrease={fontScale < fontScaleLevels.at(-1)!}
            display={fontScaleLabels[fontScale]}
            label="字号"
            onStep={(delta) => {
              const next = fontScaleLevels[fontScaleLevels.indexOf(fontScale) + delta];
              if (next) selectFontScale(next);
            }}
          />
          {fontSave.error && (
            <p className="text-[12px] text-red" role="alert">
              {fontSave.error}
            </p>
          )}
        </SettingRow>
        <SettingRow description="重启应用后生效。" settingId="icon" title="应用图标">
          <div aria-label="应用图标" className="flex flex-wrap items-center gap-2" role="group">
            {icons.map(({ id, label, src }) => (
              <button
                aria-label={label}
                aria-pressed={icon === id}
                className={cn(
                  'relative rounded-card border border-line p-2 transition-colors',
                  icon === id ? 'border-ink bg-hover' : 'border-line hover:bg-hover',
                )}
                disabled={iconSave.busy}
                key={id}
                onClick={() => selectIcon(id)}
                title={label}
                type="button"
              >
                <img alt="" className="size-12 rounded-control border border-line" src={src} />
                {icon === id ? (
                  <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-ink text-surface">
                    <Check className="size-2.5" strokeWidth={2.5} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {iconSave.error && (
            <p className="text-[12px] text-red" role="alert">
              {iconSave.error}
            </p>
          )}
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
