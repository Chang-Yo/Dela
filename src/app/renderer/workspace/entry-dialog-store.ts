import { create } from 'zustand';
import type { EntryDialogRequest } from './entry-dialogs';

export const useEntryDialog = create<{
  request: EntryDialogRequest | null;
  open(request: EntryDialogRequest): void;
  close(): void;
}>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));
