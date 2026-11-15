import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Navigate } from '../../../app/module';
import { errorMessage } from '../../../core/protocol/contract';
import { CredentialRow } from '../../../modules/settings/view';
import { showToast } from '../../../ui/toast';
import { Button } from '../../../ui/button';
import { ShuiyuanIcon } from './shuiyuan-icon';
import { shuiyuanClient, useShuiyuanState } from './use-shuiyuan';

export function ShuiyuanCredential({ navigate }: { navigate: Navigate }) {
  const queryClient = useQueryClient();
  const username = useShuiyuanState().data?.username ?? null;
  // 两步确认防误触：解绑会在站点撤销授权，重新授权成本高。
  const [confirming, setConfirming] = useState(false);
  const unbind = useMutation({
    mutationFn: () => shuiyuanClient.unbind(),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.resetQueries({ queryKey: ['shuiyuan'] });
    },
    onError: (cause) =>
      showToast({ variant: 'error', title: '解除绑定失败', description: errorMessage(cause) }),
  });

  return (
    <CredentialRow
      connected={Boolean(username)}
      description="读取与写入授权（浏览、回复、私信）"
      icon={ShuiyuanIcon}
      name="水源社区"
      settingId="shuiyuan"
      status={username ? `已绑定 · @${username}` : '未绑定'}
    >
      {username ? (
        <Button
          className="shrink-0"
          disabled={unbind.isPending}
          onClick={() => (confirming ? unbind.mutate() : setConfirming(true))}
          size="sm"
          variant="secondary"
        >
          {unbind.isPending ? '解除中…' : confirming ? '确认解除？' : '解除绑定'}
        </Button>
      ) : (
        <Button
          className="shrink-0"
          onClick={() => navigate({ page: 'shuiyuan' })}
          size="sm"
          variant="secondary"
        >
          去绑定
        </Button>
      )}
    </CredentialRow>
  );
}
