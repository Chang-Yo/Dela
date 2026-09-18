import { useState } from 'react';
import { llmProviderPresets } from '../../../shared/llm-presets';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { errorText } from '../projects/workspace';

/** 模型服务快捷配置：选预设厂商并填入 API Key 即可开始对话；完整管理在设置 › 模型服务。 */
export function ModelKeyForm({ onConfigured }: { onConfigured: () => void }) {
  const [presetId, setPresetId] = useState(llmProviderPresets[0]!.id);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preset = llmProviderPresets.find((item) => item.id === presetId)!;
  const models = preset.models;
  const [model, setModel] = useState(models[0] ?? '');

  const changePreset = (id: string) => {
    setPresetId(id);
    setModel(llmProviderPresets.find((item) => item.id === id)!.models[0] ?? '');
  };

  return (
    <form
      className="grid shrink-0 gap-3 border-b p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const dela = window.dela;
        if (!dela) return;
        setBusy(true);
        void dela.llm
          .save({
            name: preset.name,
            baseUrl: preset.baseUrl,
            apiKey: key,
            models,
            model,
            presetId: preset.id,
          })
          .then((saved) => dela.llm.setActive(saved.id))
          .then(onConfigured)
          .catch((e) => setError(errorText(e)))
          .finally(() => setBusy(false));
      }}
    >
      <label className="grid gap-2 text-xs">
        模型服务
        <select
          aria-label="模型服务"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          onChange={(event) => changePreset(event.target.value)}
          value={presetId}
        >
          {llmProviderPresets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {models.length > 0 && (
        <label className="grid gap-2 text-xs">
          模型
          <select
            aria-label="模型"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            onChange={(event) => setModel(event.target.value)}
            value={model}
          >
            {models.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="grid gap-2 text-xs">
        API Key
        <Input
          autoComplete="off"
          onChange={(event) => setKey(event.target.value)}
          placeholder="sk-…"
          required
          type="password"
          value={key}
        />
      </label>
      {error && (
        <p className="text-xs [overflow-wrap:anywhere] text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy} size="sm" type="submit">
        {busy ? '处理中…' : '保存并开始对话'}
      </Button>
    </form>
  );
}
