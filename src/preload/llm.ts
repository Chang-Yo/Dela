import type { LlmApi, LlmSaveInput, LlmVerifyInput } from '../shared/api';
import { invoke } from './lib';

export const llm = {
  list: () => invoke('llm:list'),
  save: (input: LlmSaveInput) => invoke('llm:save', input),
  remove: (id: string) => invoke('llm:remove', id),
  setEnabled: (id: string, enabled: boolean) => invoke('llm:set-enabled', id, enabled),
  verify: (input: LlmVerifyInput) => invoke('llm:verify', input),
  verifyModel: (input: Parameters<LlmApi['verifyModel']>[0]) => invoke('llm:verify-model', input),
} satisfies LlmApi;
