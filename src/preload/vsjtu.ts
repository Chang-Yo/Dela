import type { VsjtuApi, VideoDownload } from '../shared/vsjtu';
import { invoke, on } from './lib';
export const vsjtu = {
  connect: () => invoke('vsjtu:connect'),
  listCourses: () => invoke('vsjtu:list-courses'),
  listVideos: (id: number) => invoke('vsjtu:list-videos', id),
  streams: (id: number) => invoke('vsjtu:streams', id),
  download: (id: number, view: number, name: string) => invoke('vsjtu:download', id, view, name),
  downloads: () => invoke('vsjtu:downloads'),
  cancelDownload: (id: string) => invoke('vsjtu:cancel-download', id),
  revealDownload: (id: string) => invoke('vsjtu:reveal-download', id),
  onDownload: (listener: (download: VideoDownload) => void) =>
    on('vsjtu:download-changed', listener),
} satisfies VsjtuApi;
