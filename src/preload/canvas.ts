import type { CanvasApi, CanvasState } from '../shared/api';
import { invoke, on } from './lib';

export const canvas = {
  getState: () => invoke('canvas:get-state'),
  configure: (token: string) => invoke('canvas:configure', token),
  disconnect: () => invoke('canvas:disconnect'),
  syncCourses: () => invoke('canvas:sync-courses'),
  syncCourse: (id: number) => invoke('canvas:sync-course', id),
  archiveCourse: (id: number, archived: boolean) => invoke('canvas:archive-course', id, archived),
  read: (id: string) => invoke('canvas:read', id),
  download: (id: string) => invoke('canvas:download', id),
  reveal: (id: string) => invoke('canvas:reveal', id),
  openLink: (url: string) => invoke('canvas:open-link', url),
  getCacheStats: () => invoke('canvas:cache-stats'),
  getCachePins: () => invoke('canvas:cache-pins'),
  updateCachePolicy: (policy) => invoke('canvas:update-cache-policy', policy),
  setCachePin: (scope, pinned) => invoke('canvas:set-cache-pin', scope, pinned),
  clearCache: (scope) => invoke('canvas:clear-cache', scope),
  openCacheDirectory: () => invoke('canvas:open-cache-directory'),
  cachedFiles: () => invoke('canvas:cached-files'),
  exportCourseFiles: (courseIds: number[]) => invoke('canvas:export-course-files', courseIds),
  onState: (listener: (state: CanvasState) => void) => on<CanvasState>('canvas:state', listener),
} satisfies CanvasApi;
