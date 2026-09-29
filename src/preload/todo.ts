import type { TodoApi, TodoSaveInput, TodoState } from '../shared/api';
import { invoke, on } from './lib';

export const todo = {
  getState: () => invoke('todo:get-state'),
  refresh: () => invoke('todo:refresh'),
  save: (input: TodoSaveInput) => invoke('todo:save', input),
  remove: (id: string) => invoke('todo:remove', id),
  markRead: (id: string) => invoke('todo:mark-read', id),
  onUpdate: (listener: (state: TodoState) => void) => on<TodoState>('todo:state', listener),
} satisfies TodoApi;
