import { contextBridge } from 'electron';
import type { DelaApi } from '../shared/api';

contextBridge.exposeInMainWorld('dela', {
  version: '0.1.0',
} satisfies DelaApi);
