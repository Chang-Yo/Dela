import { useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { connectCanvas } from './canvas-connect';
import { errorText } from '../../../workspace/store';

type CanvasTokenFormProps = {
  /** 配置成功（已写入全局 Canvas 状态）后的回调。 */
  onSuccess: () => void;
  /** 提交按钮左侧的额外动作（如设置页对话框的「断开」「取消」）。 */
  actions?: ReactNode;
};

/** Canvas 个人 Access Token 配置表单：验证成功后拉取课程列表并写入全局工作区状态。设置页对话框使用。 */
export function CanvasTokenForm({ onSuccess, actions }: CanvasTokenFormProps) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configure = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectCanvas(key);
      setKey('');
      onSuccess();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void configure();
      }}
    >
      <label className="grid gap-2 text-sm">
        Access Token
        <Input
          autoComplete="off"
          autoFocus
          onChange={(event) => setKey(event.target.value)}
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
      <div className="flex items-center justify-end gap-2">
        {actions}
        <Button disabled={busy} type="submit">
          {busy ? '处理中…' : '保存并连接'}
        </Button>
      </div>
    </form>
  );
}
