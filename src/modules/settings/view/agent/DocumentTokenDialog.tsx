import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import type { AgentCapabilityView } from '../../../../core/protocol/capabilities';
import { errorMessage } from '../../../../core/protocol/contract';
import { Button } from '../../../../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../../ui/dialog';
import { ErrorText } from '../../../../ui/error-text';
import { Input } from '../../../../ui/input';
import { capabilitiesClient } from '../../../chat/view';

const TOKEN_PAGE = 'https://mineru.net/apiManage/token';

export function DocumentTokenDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (capabilities: AgentCapabilityView[]) => void;
}) {
  const queryClient = useQueryClient();
  const configured = useQuery({
    queryKey: ['capabilities', 'documentToken'],
    queryFn: () => capabilitiesClient.hasDocumentToken(),
  }).data;
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (operation: () => Promise<AgentCapabilityView[]>) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await operation());
      await queryClient.invalidateQueries({ queryKey: ['capabilities', 'documentToken'] });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setBusy(false);
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => capabilitiesClient.saveDocumentToken(token));
          }}
        >
          <DialogTitle>MinerU Token</DialogTitle>
          <DialogDescription>
            read_document 会把文档上传到 MinerU 解析；Token 加密保存在本机，保存后自动开启。
          </DialogDescription>
          <div className="mt-4 flex flex-col gap-3">
            <Button
              className="self-start"
              onClick={() => window.open(TOKEN_PAGE)}
              size="sm"
              type="button"
              variant="outline"
            >
              <ExternalLink aria-hidden="true" />
              登录 mineru.net 创建 Token
            </Button>
            <Input
              aria-label="MinerU Token"
              autoComplete="off"
              autoFocus
              disabled={busy}
              onChange={(event) => setToken(event.target.value)}
              placeholder={configured ? '已配置，粘贴新 Token 可替换' : '粘贴 MinerU Token'}
              required
              type="password"
              value={token}
            />
          </div>
          {error && <ErrorText className="mt-2">{error}</ErrorText>}
          <div className="flex items-center gap-2 pt-4">
            {configured && (
              <Button
                disabled={busy}
                onClick={() => void run(() => capabilitiesClient.removeDocumentToken())}
                type="button"
                variant="ghost"
              >
                移除 Token
              </Button>
            )}
            <Button
              className="ml-auto"
              disabled={busy}
              onClick={onClose}
              type="button"
              variant="ghost"
            >
              取消
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? '正在验证…' : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
