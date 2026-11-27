// 内置终端：项目目录里的交互 PTY，远程项目经本地 ssh -tt；另导出随包 MinGit 的 Bash 定位。
import { app } from 'electron';
import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { terminalContract } from './contract';
import {
  closeAllTerminals,
  closeProjectTerminals,
  closeTerminal,
  createTerminal,
  listTerminals,
  resizeTerminal,
  writeTerminal,
} from './main/sessions';

export { closeAllTerminals } from './main/sessions';
export { locateBash, prependRuntimePath } from './main/mingit';

export const terminalModule = defineModule({
  id: 'terminal',
  ipc: implement(terminalContract, {
    list: listTerminals,
    create: ({ projectId, id }) => createTerminal(projectId, id),
    write: ({ id, data }) => writeTerminal(id, data),
    resize: ({ id, cols, rows }) => resizeTerminal(id, cols, rows),
    close: closeTerminal,
    closeProject: closeProjectTerminals,
  }),
  register() {
    app.on('will-quit', closeAllTerminals);
  },
});
