import { contextBridge, webUtils } from 'electron';
import { version } from '../../package.json';
import type { DelaApi } from './api';
import { bridge } from './bridge';
import { windowApi } from './window';

contextBridge.exposeInMainWorld('dela', {
  platform: process.platform,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  bridge,
  version,
  updatedOnLaunch: process.argv.includes('--dela-updated'),
  window: windowApi,
} satisfies DelaApi);
