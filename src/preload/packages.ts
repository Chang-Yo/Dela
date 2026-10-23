import type {
  ExtensionSessionState,
  ExtensionUiEvent,
  ExtensionUiRequest,
  PackageApi,
  PackageProgress,
  PackageSettings,
} from '../shared/packages';
import { invoke, on, send } from './lib';

// packages:* 通道透传（主进程实现见 src/main/agent/packages-ipc.ts）。
export const packages: PackageApi = {
  settings: () => invoke('packages:settings'),
  enable: () => invoke('packages:enable'),
  disable: () => invoke('packages:disable'),
  cancelRuntimeInstall: () => invoke('packages:cancel-runtime-install'),
  setRegistry: (registry) => invoke('packages:set-registry', registry),
  onSettingsChanged: (listener) => on<PackageSettings>('packages:settings-changed', listener),
  list: () => invoke('packages:list'),
  install: (source) => invoke('packages:install', source),
  pickLocal: () => invoke('packages:pick-local'),
  setEnabled: (id, enabled) => invoke('packages:set-enabled', id, enabled),
  setResources: (id, resources) => invoke('packages:set-resources', id, resources),
  setPromptEnabled: (name, enabled) => invoke('packages:set-prompt-enabled', name, enabled),
  update: (id) => invoke('packages:update', id),
  remove: (id) => invoke('packages:remove', id),
  reveal: (id) => invoke('packages:reveal', id),
  onProgress: (listener) => on<PackageProgress>('packages:progress', listener),
  onUiRequest: (listener) => on<ExtensionUiRequest>('packages:ui-request', listener),
  reply: (id, value) => invoke('packages:ui-reply', id, value),
  onUiDismiss: (listener) => on<string>('packages:ui-dismiss', listener),
  reportEditorText: (sessionId, text) => send('packages:editor-text', sessionId, text),
  onUiEvent: (listener) => on<ExtensionUiEvent>('packages:ui-event', listener),
  onSessionState: (listener) => on<ExtensionSessionState>('packages:session-state', listener),
  sessionState: (sessionId) => invoke('packages:session-state', sessionId),
};
