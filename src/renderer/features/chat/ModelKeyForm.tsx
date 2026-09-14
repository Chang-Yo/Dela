import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { errorText } from '../projects/workspace';

const models = [
  { value: 'qwen', label: 'Qwen' },
  { value: 'deepseek-chat', label: 'DeepSeek' },
  { value: 'deepseek-reasoner', label: 'DeepSeek · 深度思考' },
  { value: 'minimax', label: 'MiniMax' },
];

/** 致远一号 API Key 配置；仅在未配置或用户主动打开设置时显示。 */
export function ModelKeyForm({ model, onConfigured }: { model: string; onConfigured: () => void }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState(model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid shrink-0 gap-3 border-b p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!window.dela) return;
        setBusy(true);
        void window.dela.workspace
          .configureModel(key, value)
          .then(onConfigured)
          .catch((e) => setError(errorText(e)))
          .finally(() => setBusy(false));
      }}
    >
      <label className="grid gap-2 text-xs">
        致远一号 API Key
        <Input
          autoComplete="off"
          onChange={(event) => setKey(event.target.value)}
          placeholder="sk-…"
          required
          type="password"
          value={key}
        />
      </label>
      <label className="grid gap-2 text-xs">
        模型
        <select
          aria-label="模型"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          onChange={(event) => setValue(event.target.value)}
          value={value}
        >
          {models.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy} size="sm" type="submit">
        保存配置
      </Button>
    </form>
  );
}
