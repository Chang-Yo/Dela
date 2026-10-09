import { ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import {
  browseRemote,
  listRemotes,
  probeConnection,
  remoteDraftSchema,
  remoteIdSchema,
  removeRemote,
  saveRemote,
} from './api';

const saveInputSchema = remoteDraftSchema.extend({ id: remoteIdSchema.nullable().optional() });

export function registerRemoteIpc() {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`remotes:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  handle('list', () => listRemotes());
  handle('save', (draft) => saveRemote(saveInputSchema.parse(draft)));
  handle('remove', (id) => removeRemote(remoteIdSchema.parse(id)));
  handle('probe', (draft) => probeConnection(remoteDraftSchema.parse(draft)));
  handle('browse', (draft, path) =>
    browseRemote(remoteDraftSchema.parse(draft), z.string().max(4096).nullable().parse(path)),
  );
}
