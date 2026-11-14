// 终端的渲染端出口。xterm 体积大，TerminalTab 在标签首次打开时才加载。
import { lazy } from 'react';

export { onTerminalEvent, terminalClient } from './client';

export const TerminalTab = lazy(() =>
  import('./TerminalTab').then((module) => ({ default: module.TerminalTab })),
);
