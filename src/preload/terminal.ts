import type {
  BashInstallSnapshot,
  BashStatus,
  TerminalApi,
  TerminalEvent,
  TerminalSession,
} from '../shared/terminal';
import { invoke, on } from './lib';

export const terminal: TerminalApi = {
  list: (projectId) => invoke('terminal:list', projectId) as Promise<TerminalSession[]>,
  create: (projectId, id) => invoke('terminal:create', projectId, id) as Promise<TerminalSession>,
  write: (id, data) => invoke('terminal:write', id, data) as Promise<void>,
  resize: (id, cols, rows) => invoke('terminal:resize', id, cols, rows) as Promise<void>,
  close: (id) => invoke('terminal:close', id) as Promise<void>,
  closeProject: (projectId) => invoke('terminal:close-project', projectId) as Promise<void>,
  bashStatus: () => invoke('terminal:bash-status') as Promise<BashStatus>,
  installBash: () => invoke('terminal:install-bash') as Promise<BashStatus>,
  cancelBashInstall: () => invoke('terminal:cancel-install-bash') as Promise<void>,
  onBashInstall: (listener) => on<BashInstallSnapshot>('terminal:bash-install', listener),
  onEvent: (listener) => on<TerminalEvent>('terminal:event', listener),
};
