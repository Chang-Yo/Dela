// 会话的渲染端出口：首页、会话与审阅标签、会话镜像与归档页。会话标签随首页静态加载，审阅标签懒加载。
import { lazy } from 'react';

export {
  agentClient,
  capabilitiesClient,
  chatClient,
  llmClient,
  onAgentEvent,
  onWebSearchChanged,
} from './client';
export { ArchivedSection } from './ArchivedSection';
export { ChatHome, type HomeChatRequest } from './ChatHome';
export { ChatTab } from './ChatTab';
export {
  ChatTabSourceProvider,
  type ChatTabSource,
  type ReferenceEntry,
  type ReferenceSource,
} from './chat-source';
export { registerChatAttachmentCheck, saveChatDrafts, useChatDrafts } from './drafts';
export { referenceEntryCandidates } from './reference-tokens';
export { reviewTabTitle } from './review/tab-id';
export { runBadge, useRuns, useSessionRunStatus } from './runs';
export { refreshSessionLists, updateSession, useSessions } from './sessions';

export const ReviewTab = lazy(() =>
  import('./review/ReviewTab').then((module) => ({ default: module.ReviewTab })),
);
