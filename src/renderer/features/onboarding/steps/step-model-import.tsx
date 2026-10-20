import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';
import { cn } from '../../../lib/utils';
import { LLM_MODEL_LIMIT } from '../../../../shared/llm-presets';
import { capModels, selectedModels } from './model-import';

/** 向导 · 导入模型弹层：从检测到的模型列表里勾选要写进配置的那些，默认勾上已导入的。 */
export function StepModelImportDialog({
  open,
  onOpenChange,
  options,
  preselected,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: string[];
  /** 当前已导入的模型，打开时默认勾选。 */
  preselected: string[];
  /** 按检测列表顺序回传勾选结果。 */
  onConfirm: (picked: string[]) => void;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        {/* 弹层 portal 到 body，脱离向导的 .bui-light 作用域，遮罩与面板需各自带上。 */}
        <Dialog.Overlay className={cn(dialogOverlay, 'bui-light')} />
        <Dialog.Content className={cn(dialogPanel, 'bui-light max-h-[85vh] max-w-md')}>
          <Dialog.Title className="text-base font-semibold">导入模型</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-xs leading-relaxed text-ink-3">
            勾选要加入配置的模型，最多保留 {LLM_MODEL_LIMIT} 个。
          </Dialog.Description>
          <Picker onConfirm={onConfirm} options={options} preselected={preselected} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 弹层内容：关闭即卸载，勾选状态下次打开时按 preselected 重新初始化。 */
function Picker({
  options,
  preselected,
  onConfirm,
}: {
  options: string[];
  preselected: string[];
  onConfirm: (picked: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState(() => new Set(preselected));
  const picked = selectedModels(options, checked);
  // 上限规则只有 model-import 一处，这里借它算出「勾了但装不下」的数量。
  const dropped = picked.length - capModels(picked).models.length;
  const keyword = query.trim().toLowerCase();
  const visible = options.filter((id) => id.toLowerCase().includes(keyword));

  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mt-4 grid gap-3">
      <Input
        aria-label="搜索模型 ID"
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`搜索 ${options.length} 个模型…`}
        value={query}
      />
      <div className="max-h-64 overflow-y-auto rounded-card border border-line">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-xs text-ink-3">没有匹配的模型</p>
        ) : (
          visible.map((id) => (
            <label
              className="flex min-w-0 cursor-pointer items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-hover"
              key={id}
            >
              <input
                checked={checked.has(id)}
                className="size-3.5 shrink-0 accent-[var(--onboarding-accent)]"
                onChange={() => toggle(id)}
                type="checkbox"
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>
                {id}
              </span>
            </label>
          ))
        )}
      </div>
      <p className="text-xs text-ink-3" role="status">
        已选 {picked.length} 个{dropped > 0 ? `，超出的 ${dropped} 个不会被导入` : ''}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Dialog.Close asChild>
          <Button size="sm" variant="secondary">
            取消
          </Button>
        </Dialog.Close>
        <Button disabled={picked.length === 0} onClick={() => onConfirm(picked)} size="sm">
          导入所选 {picked.length} 个
        </Button>
      </div>
    </div>
  );
}
