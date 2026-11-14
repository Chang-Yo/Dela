import { contextBridge } from 'electron';
import { version } from '../../package.json';
import type { DelaApi } from '../shared/api';
import { canvas } from './canvas';
import { cache } from './cache';
import { chat } from './chat';
import { consent } from './consent';
import { backup } from './backup';
import { bridge } from './bridge';
import { llm } from './llm';
import { capabilityApi as capability } from './capabilities';
import { layout } from './layout';
import { mail } from './mail';
import { remotes } from './remotes';
import { session, sidechat } from './session';
import { settings } from './settings';
import { terminal } from './terminal';
import { update } from './update';
import { windowApi } from './window';
import { workspace } from './workspace';

contextBridge.exposeInMainWorld('dela', {
  platform: process.platform,
  bridge,
  version,
  updatedOnLaunch: process.argv.includes('--dela-updated'),
  terminal,
  remotes,
  window: windowApi,
  settings,
  consent,
  backup,
  cache,
  llm,
  chat,
  mail,
  canvas,
  workspace,
  session,
  sidechat,
  layout,
  capability,
  update,
} satisfies DelaApi);
