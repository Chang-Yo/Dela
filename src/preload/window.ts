import type { TrayAction, WindowApi, WindowState } from '../shared/api';
import { on, invoke, send } from './lib';

export const windowApi = {
  minimize: () => send('window:minimize'),
  toggleMaximize: () => send('window:toggle-maximize'),
  close: () => send('window:close'),
  quit: () => send('window:quit'),
  getState: () => invoke('window:get-state'),
  onStateChange: (listener: (state: WindowState) => void) =>
    on<WindowState>('window:state', listener),
  onTrayAction: (listener: (action: TrayAction) => void) =>
    on<TrayAction>('window:tray-action', listener),
} satisfies WindowApi;
