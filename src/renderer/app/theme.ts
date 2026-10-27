// 主题/缩放/字号的应用与 localStorage 镜像。
import { useEffect, useState } from 'react';
import type { ThemePreference, ZoomPreference } from '../../shared/api';
import { fontSizeDefault, fontSizeMax, fontSizeMin } from '../../shared/api';

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

/** 桌面端主题/缩放事实在主进程 DB；这里持视图状态、应用 CSS 效果并镜像到 localStorage。 */
export function useAppearance() {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [zoom, setZoom] = useState<ZoomPreference>(1);
  const [fontSize, setFontSize] = useState<number>(initialFontSize);

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
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem(fontSizeStorageKey, String(fontSize));
  }, [fontSize]);

  // 浏览器预览没有主进程缩放，用 CSS zoom 降级；桌面端由主进程 setZoomFactor 生效。
  useEffect(() => {
    if (!window.dela) document.documentElement.style.zoom = String(zoom);
  }, [zoom]);

  useEffect(() => {
    void window.dela?.settings
      .getTheme()
      .then(setTheme)
      .catch(() => {});
    void window.dela?.settings
      .getZoom()
      .then(setZoom)
      .catch(() => {});
    void window.dela?.settings
      .getFontSize()
      .then(setFontSize)
      .catch(() => {});
  }, []);

  const changeTheme = async (next: ThemePreference) => {
    if (!window.dela) {
      setTheme(next);
      return;
    }
    setTheme(await window.dela.settings.setTheme(next));
  };

  const changeZoom = async (next: ZoomPreference) => {
    if (!window.dela) {
      setZoom(next);
      return;
    }
    setZoom(await window.dela.settings.setZoom(next));
  };

  const changeFontSize = async (next: number) => {
    if (!window.dela) {
      setFontSize(clampFontSize(next));
      return;
    }
    setFontSize(await window.dela.settings.setFontSize(next));
  };

  return { theme, zoom, fontSize, changeTheme, changeZoom, changeFontSize };
}
