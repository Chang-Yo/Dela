import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import { ErrorText } from '../../../ui/alert';
import { Button } from '../../../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../ui/dialog';
import { Field } from '../../../ui/field';
import { Input } from '../../../ui/input';
import type { CanvasState } from '../contract';
import { canvasClient, stateKey, useCanvasState } from './use-canvas';

export function CanvasConnectDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { connected } = useCanvasState();
  const [token, setToken] = useState('');
  const done = (state: CanvasState) => {
    queryClient.setQueryData(stateKey, state);
    onClose();
  };
  const connect = useMutation({
    mutationFn: (value: string) => canvasClient.connect(value),
    onSuccess: done,
  });
  const disconnect = useMutation({
    mutationFn: () => canvasClient.disconnect(),
    onSuccess: done,
    onError: (cause) =>
      showToast({ variant: 'error', title: '断开连接失败', description: errorMessage(cause) }),
  });
  const busy = connect.isPending || disconnect.isPending;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      open
    >
      <DialogContent scroll>
        <DialogTitle>配置 Canvas</DialogTitle>
        <DialogDescription>
          {connected
            ? '输入新的个人 Access Token 以替换当前连接。'
            : '输入个人 Access Token，验证成功后读取课程列表；凭据加密保存在本机。'}
        </DialogDescription>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            connect.mutate(token);
          }}
        >
          <Field label="Access Token">
            <Input
              autoComplete="off"
              autoFocus
              onChange={(event) => setToken(event.target.value)}
              required
              type="password"
              value={token}
            />
          </Field>
          {connect.error && <ErrorText>{errorMessage(connect.error)}</ErrorText>}
          <div className="flex items-center justify-end gap-2">
            {connected && (
              <Button disabled={busy} onClick={() => disconnect.mutate()} variant="ghost">
                断开
              </Button>
            )}
            <Button disabled={busy} onClick={onClose} variant="ghost">
              取消
            </Button>
            <Button disabled={busy} type="submit">
              {connect.isPending ? '处理中…' : '保存并连接'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
