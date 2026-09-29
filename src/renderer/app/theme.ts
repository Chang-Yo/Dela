// 主题/缩放/字号的应用与 localStorage 镜像（迁移自旧 App.tsx 的散落 effects）。
import { useEffect, useState } from 'react';
import type { FontScalePreference, ThemePreference, ZoomPreference } from '../../shared/api';
import { fontScaleLevels } from '../../shared/api';

const themeStorageKey = 'dela.theme';
const fontScaleStorageKey = 'dela.font-scale';

function initialTheme(): ThemePreference {
  const theme = localStorage.getItem(themeStorageKey);
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

// 与主题同理：localStorage 缓存避免启动瞬间回退默认字号。
function initialFontScale(): FontScalePreference {
  const value = Number(localStorage.getItem(fontScaleStorageKey));
  return (fontScaleLevels as readonly number[]).includes(value)
    ? (value as FontScalePreference)
    : 1;
}

/** 桌面端主题/缩放事实在主进程 DB；这里持视图状态、应用 CSS 效果并镜像到 localStorage。 */
export function useAppearance() {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [zoom, setZoom] = useState<ZoomPreference>(1);
  const [fontScale, setFontScale] = useState<FontScalePreference>(initialFontScale);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale));
    localStorage.setItem(fontScaleStorageKey, String(fontScale));
  }, [fontScale]);

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
      .getFontScale()
      .then(setFontScale)
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

  const changeFontScale = async (next: FontScalePreference) => {
    if (!window.dela) {
      setFontScale(next);
      return;
    }
    setFontScale(await window.dela.settings.setFontScale(next));
  };

  return { theme, zoom, fontScale, changeTheme, changeZoom, changeFontScale };
}
