import { createStore } from 'zustand';

// One foreground composer can delay navigation until its save/discard decision completes.
const composeGate = createStore<{
  confirmClose: (() => Promise<boolean>) | null;
  pending: boolean;
  allowed: boolean;
  saveHandlers: readonly (() => Promise<boolean>)[];
}>(() => ({ confirmClose: null, pending: false, allowed: false, saveHandlers: [] }));

export function registerComposeSave(handler: () => Promise<boolean>): () => void {
  composeGate.setState((gate) => ({ saveHandlers: [...gate.saveHandlers, handler] }));
  return () =>
    composeGate.setState((gate) => ({
      saveHandlers: gate.saveHandlers.filter((save) => save !== handler),
    }));
}

export async function saveComposers(): Promise<boolean> {
  for (const save of composeGate.getState().saveHandlers) if (!(await save())) return false;
  return true;
}

export function registerComposeClose(handler: () => Promise<boolean>) {
  composeGate.setState({ confirmClose: handler });
  return () => {
    if (composeGate.getState().confirmClose === handler)
      composeGate.setState({ confirmClose: null });
  };
}

export function leaveComposer(continueAction: () => void): boolean {
  const { allowed, confirmClose, pending } = composeGate.getState();
  if (allowed || !confirmClose) return true;
  if (pending) return false;
  composeGate.setState({ pending: true });
  void confirmClose()
    .then((proceed) => {
      if (!proceed) return;
      composeGate.setState({ allowed: true });
      try {
        continueAction();
      } finally {
        composeGate.setState({ allowed: false });
      }
    })
    .finally(() => {
      composeGate.setState({ pending: false });
    });
  return false;
}
