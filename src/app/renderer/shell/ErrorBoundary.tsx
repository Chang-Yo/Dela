// 捕获子树渲染期异常并降级为静态提示，避免单个标签/视图崩溃带走整个应用，不做错误上报。
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../../../ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
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

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        role="alert"
      >
        <p className="text-sm text-ink-3">{this.props.title ?? '此标签遇到错误'}</p>
        <Button size="sm" variant="outline" onClick={this.retry}>
          重试
        </Button>
      </div>
    );
  }
}
