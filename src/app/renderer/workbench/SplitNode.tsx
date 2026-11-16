// 分割节点：递归渲染纵横分屏，组间比例经 Resizer 拖拽调整；store 只产生二元 split
// （三屏经嵌套），渲染兼容 ≥2 子节点。
import { useState } from 'react';
import type { LayoutNode } from '../../../modules/workspace/contract';
import { Resizer } from '../../../ui/resizer';
import { cn } from '../../../ui/cn';
import { useWorkbenchLayout } from './layout-store';
import { TabGroup } from './TabGroup';

// 单组宽度下限 240（与目录默认宽度一致），避免正文被挤成窄条。
// 高 64 ≈ 标签栏 h-10（40px）+ 少量正文；空间不足时下限退化为容器的一半。
const GROUP_MIN_WIDTH = 240;
const GROUP_MIN_HEIGHT = 64;

interface SplitNodeProps {
  node: LayoutNode;
  path: number[];
  /** 空组空态的「新建对话」，由装配层注入。 */
  onNewChat: () => void;
}

export function SplitNodeView({ node, path, onNewChat }: SplitNodeProps) {
  const setRatio = useWorkbenchLayout((s) => s.setRatio);
  const [dimension, setDimension] = useState(0);
  const vertical = node.type === 'split' && node.orientation === 'vertical';

  // 挂载即测量一次，避免首帧按 0 宽布局；后续交给 ResizeObserver。
  const observeSize = (element: HTMLDivElement) => {
    const update = () => {
      const rect = element.getBoundingClientRect();
      setDimension(vertical ? rect.width : rect.height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  };

  if (node.type === 'group') return <TabGroup group={node} onNewChat={onNewChat} />;
  const minimum = Math.min(
    vertical ? GROUP_MIN_WIDTH : GROUP_MIN_HEIGHT,
    Math.max(1, dimension / 2),
  );
  const maximum = Math.max(minimum, dimension - minimum);
  const value = Math.min(maximum, Math.max(minimum, dimension * node.ratio));
  const ratio = dimension > 0 ? value / dimension : node.ratio;

  return (
    <div
      ref={observeSize}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 overflow-hidden',
        vertical ? 'flex-row' : 'flex-col',
      )}
    >
      <div
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ flex: `${ratio} 1 0%` }}
      >
        <SplitNodeView node={node.children[0]!} path={[...path, 0]} onNewChat={onNewChat} />
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
          // 两个白色页面相邻，保留一条淡线作分界。
          'bg-line/60',
          vertical ? 'w-px' : 'h-px',
        )}
      />
      {node.children.slice(1).map((child, index) => (
        <div
          key={child.type === 'group' ? child.id : `split-${path.join('.')}-${index + 1}`}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden"
          style={{ flex: `${(1 - ratio) / (node.children.length - 1)} 1 0%` }}
        >
          <SplitNodeView node={child} path={[...path, index + 1]} onNewChat={onNewChat} />
        </div>
      ))}
    </div>
  );
}
