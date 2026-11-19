// 应用内更新：主进程持有状态，electron-updater 负责版本比较、校验、差分下载与 NSIS 安装。
import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { updateContract } from './contract';
import {
  beginCheck,
  beginDownload,
  beginInstall,
  currentState,
  deferInstall,
  openDownloadPage,
  startBackgroundUpdateCheck,
} from './main/updater';

export const updateModule = defineModule({
  id: 'update',
  ipc: implement(updateContract, {
    state: currentState,
    check: beginCheck,
    download: beginDownload,
    install: beginInstall,
    deferInstall,
    openDownloadPage,
  }),
  start: startBackgroundUpdateCheck,
});
