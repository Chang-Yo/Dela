import { useQuery, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { createClient } from '../../../core/protocol/contract';
import { canvasContract, type CanvasState } from '../contract';

export const canvasClient = createClient(canvasContract, window.dela?.bridge);

export const stateKey = ['canvas', 'state'];

const disconnected: CanvasState = { connected: false, syncedAt: null, courses: [], items: [] };

export function useCanvasState(): CanvasState {
  return useQuery({ queryKey: stateKey, queryFn: () => canvasClient.state() }).data ?? disconnected;
}

export function cachedCanvasState(client: QueryClient): CanvasState {
  return client.getQueryData<CanvasState>(stateKey) ?? disconnected;
}

/** 资料页与归档区两棵树共用的分组方式。 */
export const useLibraryGrouping = create<{ bySource: boolean; toggle: () => void }>((set) => ({
  bySource: false,
  toggle: () => set((state) => ({ bySource: !state.bySource })),
}));
