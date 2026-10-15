import type { BackupApi } from '../shared/backup';
import { invoke } from './lib';

export const backup: BackupApi = {
  exportData: () => invoke('backup:export'),
};
