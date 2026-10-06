import type { VsjtuApi } from '../shared/api';
import { invoke } from './lib';

export const vsjtu = {
  getState: () => invoke('vsjtu:get-state'),
  login: () => invoke('vsjtu:login'),
  sync: () => invoke('vsjtu:sync'),
  list: () => invoke('vsjtu:list'),
  getPlayInfo: (courseId: number) => invoke('vsjtu:play-info', courseId),
  getTranscript: (courseId: number) => invoke('vsjtu:transcript', courseId),
  getChapters: (courseId: number) => invoke('vsjtu:chapters', courseId),
  getPpt: (courseId: number) => invoke('vsjtu:ppt', courseId),
  addSourceRef: (videoId: number) => invoke('vsjtu:add-source-ref', videoId),
  getSourceRef: (videoId: number) => invoke('vsjtu:get-source-ref', videoId),
  openLink: (url: string) => invoke('vsjtu:open-link', url),
} satisfies VsjtuApi;
