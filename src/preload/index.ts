import { contextBridge, webUtils } from 'electron';
import { version } from '../../package.json';
import type { DelaApi } from '../shared/api';
import { cache } from './cache';
import { consent } from './consent';
import { backup } from './backup';
import { bridge } from './bridge';
import { settings } from './settings';
import { update } from './update';
import { windowApi } from './window';

contextBridge.exposeInMainWorld('dela', {
  platform: process.platform,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  bridge,
  version,
  updatedOnLaunch: process.argv.includes('--dela-updated'),
  window: windowApi,
  settings,
  consent,
  backup,
  cache,
  update,
} satisfies DelaApi);
