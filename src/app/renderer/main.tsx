import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { views } from '../views';
import { useUpdateState } from '../../modules/update/view';
import { ErrorBoundary } from './shell/ErrorBoundary';
import App from './shell/App';
import { connectQueryEvents } from './shell/query-events';
import { saveWorkspace } from './shell/save-workspace';
import { useNavigationStore } from './navigation/view';
import { useShortcuts } from './shell/shortcuts';
import { useWorkspaceStore } from '../../modules/workspace/view';
import './styles/globals.css';

// 后端数据的唯一缓存（docs/adr/0009）：数据都在本机主进程，失败不重试，切回窗口不重查。
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const bridge = window.dela?.bridge;
if (bridge) connectQueryEvents(queryClient, bridge.queryEvents, bridge);
for (const view of views) view.start?.(useNavigationStore.getState().navigate);
useUpdateState.setState({ beforeInstall: saveWorkspace });
void useWorkspaceStore.getState().load();
void useShortcuts.getState().load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary title="应用遇到错误">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
