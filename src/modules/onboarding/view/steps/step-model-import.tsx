import { useState } from 'react';
import { Button } from '../../../../ui/button';
import { Card } from '../../../../ui/card';
import { Checkbox } from '../../../../ui/checkbox';
import { Input } from '../../../../ui/input';
import { LLM_MODEL_LIMIT } from '../../../../core/protocol/llm-models';
import { capModels, selectedModels } from './model-import';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../../ui/dialog';

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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="bui-light max-h-[85vh]">
        <DialogTitle>导入模型</DialogTitle>
        <DialogDescription>勾选要加入配置的模型，最多保留 {LLM_MODEL_LIMIT} 个。</DialogDescription>
        <Picker
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
          options={options}
          preselected={preselected}
        />
      </DialogContent>
    </Dialog>
  );
}

/** 弹层内容：关闭即卸载，勾选状态下次打开时按 preselected 重新初始化。 */
function Picker({
  options,
  preselected,
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
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
      <Card className="max-h-64 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-xs text-ink-3">没有匹配的模型</p>
        ) : (
          visible.map((id) => (
            <label
              className="flex min-w-0 cursor-pointer items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-hover"
              key={id}
            >
              <Checkbox checked={checked.has(id)} onChange={() => toggle(id)} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>
                {id}
              </span>
            </label>
          ))
        )}
      </Card>
      <p className="text-xs text-ink-3" role="status">
        已选 {picked.length} 个{dropped > 0 ? `，超出的 ${dropped} 个不会被导入` : ''}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel} size="sm" variant="secondary">
          取消
        </Button>
        <Button disabled={picked.length === 0} onClick={() => onConfirm(picked)} size="sm">
          导入所选 {picked.length} 个
        </Button>
      </div>
    </div>
  );
}
