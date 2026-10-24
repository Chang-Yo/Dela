import type { VsjtuApi, VideoDownload } from '../shared/vsjtu';
import { invoke, on } from './lib';
export const vsjtu = {
  connect: () => invoke('vsjtu:connect'),
  listCourses: () => invoke('vsjtu:list-courses'),
  listVideos: (id: number) => invoke('vsjtu:list-videos', id),
  streams: (id: number) => invoke('vsjtu:streams', id),
  transcript: (id: number) => invoke('vsjtu:transcript', id),
  exportTranscript: (id: number, title: string) => invoke('vsjtu:export-transcript', id, title),
  download: (id: number, view: number, name: string) => invoke('vsjtu:download', id, view, name),
  downloads: () => invoke('vsjtu:downloads'),
  cancelDownload: (id: string) => invoke('vsjtu:cancel-download', id),
  revealDownload: (id: string) => invoke('vsjtu:reveal-download', id),
  getDownloadDirectory: () => invoke('vsjtu:get-download-directory'),
  chooseDownloadDirectory: () => invoke('vsjtu:choose-download-directory'),
  onDownload: (listener: (download: VideoDownload) => void) =>
    on('vsjtu:download-changed', listener),
} satisfies VsjtuApi;
