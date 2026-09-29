import type { LayoutApi, WorkbenchLayout } from '../shared/api';
import { invoke } from './lib';

export const layout = {
  get: (projectId: string | null) =>
    invoke('layout:get', projectId) as Promise<WorkbenchLayout | null>,
  save: (projectId: string | null, state: WorkbenchLayout) =>
    invoke('layout:save', projectId, state) as Promise<void>,
} satisfies LayoutApi;
