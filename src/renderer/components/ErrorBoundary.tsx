// 捕获子树渲染期异常并降级为静态提示，避免单个标签/视图崩溃带走整个应用，不做错误上报。
// 包渲染层（TabGroup 标签内容、App 视图切换层）与 main.tsx 根部（兜住 AppShell/侧栏）。
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 降级标题；标签内容用默认值，视图级传「此视图遇到错误」。 */
  title?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 组件栈只进 console：布局/数据操作不经 React 树，此处错误全部来自渲染期。
    console.error(
      '[ErrorBoundary]',
      this.props.title ?? '此标签遇到错误',
      error,
      info.componentStack,
    );
  }

  /** 重试 = 清除错误状态；出错子树在上次捕获时已被 React 卸载，重渲即全新挂载。 */
  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        role="alert"
      >
        <p className="text-13 text-ink-3">{this.props.title ?? '此标签遇到错误'}</p>
        <Button size="sm" variant="outline" onClick={this.retry}>
          重试
        </Button>
      </div>
    );
  }
}
