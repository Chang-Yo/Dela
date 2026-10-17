import type { CanvasApi } from '../shared/api';
import type { CanvasState } from '../shared/canvas';
import { invoke, on } from './lib';

export const canvas = {
  getState: () => invoke('canvas:get-state'),
  onChanged: (listener: (state: CanvasState) => void) => on('canvas:changed', listener),
  configure: (token: string) => invoke('canvas:configure', token),
  disconnect: () => invoke('canvas:disconnect'),
  syncCourses: () => invoke('canvas:sync-courses'),
  refresh: () => invoke('canvas:refresh'),
  syncCourse: (id: number) => invoke('canvas:sync-course', id),
  archiveCourse: (id: number, archived: boolean) => invoke('canvas:archive-course', id, archived),
  read: (id: string) => invoke('canvas:read', id),
  download: (id: string) => invoke('canvas:download', id),
  openLink: (url: string) => invoke('canvas:open-link', url),
  cachedFiles: () => invoke('canvas:cached-files'),
} satisfies CanvasApi;
