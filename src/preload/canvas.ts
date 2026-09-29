import type { CanvasApi } from '../shared/api';
import { invoke } from './lib';

export const canvas = {
  getState: () => invoke('canvas:get-state'),
  configure: (token: string) => invoke('canvas:configure', token),
  disconnect: () => invoke('canvas:disconnect'),
  syncCourses: () => invoke('canvas:sync-courses'),
  syncCourse: (id: number) => invoke('canvas:sync-course', id),
  archiveCourse: (id: number, archived: boolean) => invoke('canvas:archive-course', id, archived),
  read: (id: string) => invoke('canvas:read', id),
  download: (id: string) => invoke('canvas:download', id),
  openLink: (url: string) => invoke('canvas:open-link', url),
} satisfies CanvasApi;
