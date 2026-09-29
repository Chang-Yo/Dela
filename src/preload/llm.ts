import type { LlmApi, LlmSaveInput, LlmVerifyInput } from '../shared/api';
import { invoke } from './lib';

export const llm = {
  list: () => invoke('llm:list'),
  save: (input: LlmSaveInput) => invoke('llm:save', input),
  remove: (id: string) => invoke('llm:remove', id),
  setActive: (id: string) => invoke('llm:set-active', id),
  setModel: (model: string) => invoke('llm:set-model', model),
  setEffort: (level: string) => invoke('llm:set-effort', level),
  verify: (input: LlmVerifyInput) => invoke('llm:verify', input),
} satisfies LlmApi;
