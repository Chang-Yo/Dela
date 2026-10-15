import type { ConsentApi } from '../shared/consent';
import { invoke } from './lib';

export const consent: ConsentApi = {
  record: (document, revision) => invoke('consent:record', document, revision),
};
