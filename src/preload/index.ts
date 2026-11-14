import { contextBridge, webUtils } from 'electron';
import { version } from '../../package.json';
import type { DelaApi } from '../shared/api';
import { cache } from './cache';
import { chat } from './chat';
import { consent } from './consent';
import { backup } from './backup';
import { bridge } from './bridge';
import { llm } from './llm';
import { capabilityApi as capability } from './capabilities';
import { mail } from './mail';
import { remotes } from './remotes';
import { session, sidechat } from './session';
import { settings } from './settings';
import { terminal } from './terminal';
import { update } from './update';
import { windowApi } from './window';

contextBridge.exposeInMainWorld('dela', {
  platform: process.platform,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
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
  session,
  sidechat,
  capability,
  update,
} satisfies DelaApi);
