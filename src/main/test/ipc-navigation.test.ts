import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {},
  clipboard: {},
  Menu: {},
}));

import { isSameRendererNavigation } from '../ipc';

describe('renderer 导航边界', () => {
  it('允许开发服务器同源重载与路由，不把本地页面交给系统浏览器', () => {
    expect(
      isSameRendererNavigation('http://127.0.0.1:5173/', 'http://127.0.0.1:5173/?smoke-test=1'),
    ).toBe(true);
    expect(isSameRendererNavigation('http://127.0.0.1:5173/', 'https://example.com/docs')).toBe(
      false,
    );
  });

  it('生产环境只允许同一个 file 入口重载', () => {
    expect(
      isSameRendererNavigation(
        'file:///opt/Dela/resources/app.asar/out/renderer/index.html',
        'file:///opt/Dela/resources/app.asar/out/renderer/index.html?reload=1',
      ),
    ).toBe(true);
    expect(
      isSameRendererNavigation(
        'file:///opt/Dela/resources/app.asar/out/renderer/index.html',
        'file:///tmp/other.html',
      ),
    ).toBe(false);
  });
});
