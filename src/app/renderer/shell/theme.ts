// 主题/缩放/字号的应用与 localStorage 镜像。
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fontSizeDefault,
  fontSizeMax,
  fontSizeMin,
  type ThemePreference,
  type ZoomPreference,
} from '../../../modules/settings/contract';
import { settingsClient } from '../../../modules/settings/view';

const themeStorageKey = 'dela.theme';
const fontSizeStorageKey = 'dela.font-size';
function clampFontSize(value: number): number {
  return Math.min(fontSizeMax, Math.max(fontSizeMin, Math.round(value)));
}

function initialTheme(): ThemePreference {
  const theme = localStorage.getItem(themeStorageKey);
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

// 与主题同理：localStorage 缓存避免启动瞬间回退默认字号。
function initialFontSize(): number {
  const stored = Number(localStorage.getItem(fontSizeStorageKey));
  if (Number.isFinite(stored) && stored > 0) return clampFontSize(stored);
  return fontSizeDefault;
}

/** 桌面端主题/缩放事实在主进程 DB；这里读进查询缓存、应用 CSS 效果并镜像到 localStorage。 */
export function useAppearance() {
  const queryClient = useQueryClient();
  const enabled = Boolean(window.dela);
  const theme =
    useQuery({ queryKey: ['settings', 'theme'], queryFn: () => settingsClient.theme(), enabled })
      .data ?? initialTheme();
  const zoom =
    useQuery({ queryKey: ['settings', 'zoom'], queryFn: () => settingsClient.zoom(), enabled })
      .data ?? 1;
  const fontSize =
    useQuery({
      queryKey: ['settings', 'fontSize'],
      queryFn: () => settingsClient.fontSize(),
      enabled,
    }).data ?? initialFontSize();

  // 生效主题只由 .dark / .light 表达：跟随系统时按媒体查询解析，让所有 token（含 beautiful-ui
  // 只认 .dark 的那套）走同一条路径。
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      root.classList.toggle('dark', dark);
      root.classList.toggle('light', !dark);
    };
    apply();
    localStorage.setItem(themeStorageKey, theme);
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  // 根元素字号即用户设置：rem 派生的文字、间距与图标一起缩放。
  // 浏览器预览没有主进程缩放，用 CSS zoom 降级；桌面端由主进程 setZoomFactor 生效。
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem(fontSizeStorageKey, String(fontSize));
    if (!window.dela) document.documentElement.style.zoom = String(zoom);
  }, [fontSize, zoom]);

  // 浏览器预览没有主进程，直接写缓存；桌面端以主进程回写的规范值为准。
  const changeTheme = async (next: ThemePreference) => {
    queryClient.setQueryData(
      ['settings', 'theme'],
      window.dela ? await settingsClient.setTheme(next) : next,
    );
  };

  const changeZoom = async (next: ZoomPreference) => {
    queryClient.setQueryData(
      ['settings', 'zoom'],
      window.dela ? await settingsClient.setZoom(next) : next,
    );
  };

  const changeFontSize = async (next: number) => {
    queryClient.setQueryData(
      ['settings', 'fontSize'],
      window.dela ? await settingsClient.setFontSize(next) : clampFontSize(next),
    );
  };

  return { theme, zoom, fontSize, changeTheme, changeZoom, changeFontSize };
}
