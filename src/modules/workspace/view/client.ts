import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { workspaceContract } from '../contract';

const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const workspaceClient = createClient(workspaceContract, bridge);

export function onWorkspaceEvent<K extends keyof (typeof workspaceContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof workspaceContract, K>) => void,
): () => void {
  return subscribe(workspaceContract, bridge, name, listener);
}
