// 分割节点：递归渲染纵横分屏，组间比例经 ui/resizer 拖拽调整（px ↔ ratio 换算沿用旧
// EditorLayout 的做法）。store 只产生二元 split（三屏经嵌套），渲染兼容 ≥2 子节点。
import { useLayoutEffect, useRef, useState } from 'react';
import type { LayoutNode } from '../../shared/layout';
import { Resizer } from '../components/ui/resizer';
import { cn } from '../lib/utils';
import { useWorkbenchLayout } from './layout-store';
import { TabGroup } from './TabGroup';

// 单组需要的最小可读尺寸（与旧 EDITOR_MIN_WIDTH/HEIGHT 一致，防止组被拖到不可读）。
const GROUP_MIN_WIDTH = 320;
const GROUP_MIN_HEIGHT = 240;

export function SplitNodeView({ node, path = [] }: { node: LayoutNode; path?: number[] }) {
  const setRatio = useWorkbenchLayout((s) => s.setRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimension, setDimension] = useState(0);
  const vertical = node.type === 'split' && node.orientation === 'vertical';

  // 挂载即测量一次，避免首帧按 0 宽布局；后续交给 ResizeObserver。
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setDimension(vertical ? rect.width : rect.height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [vertical]);

  if (node.type === 'group') return <TabGroup group={node} />;
  const minimum = Math.min(
    vertical ? GROUP_MIN_WIDTH : GROUP_MIN_HEIGHT,
    Math.max(1, dimension / 2),
  );
  const maximum = Math.max(minimum, dimension - minimum);
  const value = Math.min(maximum, Math.max(minimum, dimension * node.ratio));

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 overflow-hidden',
        vertical ? 'flex-row' : 'flex-col',
      )}
    >
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        style={{ flexBasis: `${node.ratio * 100}%` }}
      >
        <SplitNodeView node={node.children[0]!} path={[...path, 0]} />
      </div>
      <Resizer
        label="调整分屏比例"
        orientation={node.orientation}
        value={value}
        min={minimum}
        max={maximum}
        defaultValue={dimension / 2}
        onChange={(next) => {
          if (dimension > 0) setRatio(path, next / dimension);
        }}
        className={cn(
          // 两个白色页面相邻，保留一条淡线作分界（沿用旧编辑区分栏样式）。
          'bg-border/60',
          vertical ? 'w-px' : 'h-px',
        )}
      />
      {node.children.slice(1).map((child, index) => (
        <div
          key={child.type === 'group' ? child.id : `split-${path.join('.')}-${index + 1}`}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <SplitNodeView node={child} path={[...path, index + 1]} />
        </div>
      ))}
    </div>
  );
}
