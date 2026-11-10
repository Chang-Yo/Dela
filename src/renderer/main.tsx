import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './app/App';
import './styles/globals.css';

// 后端数据的唯一缓存（docs/adr/0009）：数据都在本机主进程，失败不重试，切回窗口不重查。
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 根部兜底：AppShell/侧栏抛错时降级为可重试的错误页，而非整树卸载成白屏。 */}
    <ErrorBoundary title="应用遇到错误">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
