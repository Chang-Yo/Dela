// One foreground composer can delay navigation until its save/discard decision completes.
let confirmClose: (() => Promise<boolean>) | null = null;
let pending = false;
let allowed = false;

export function registerComposeClose(handler: () => Promise<boolean>) {
  confirmClose = handler;
  return () => {
    if (confirmClose === handler) confirmClose = null;
  };
}

export function leaveComposer(continueAction: () => void): boolean {
  if (allowed || !confirmClose) return true;
  if (pending) return false;
  pending = true;
  void confirmClose()
    .then((proceed) => {
      if (!proceed) return;
      allowed = true;
      try {
        continueAction();
      } finally {
        allowed = false;
      }
    })
    .finally(() => {
      pending = false;
    });
  return false;
}
