import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder } from 'lucide-react';
import { errorMessage } from '../../../core/protocol/contract';
import { SettingRow } from '../../../modules/settings/view';
import { showToast } from '../../../renderer/app/toasts';
import { Button } from '../../../ui/button';
import { classroomClient } from './use-classroom';

export function ClassroomStorage() {
  const queryClient = useQueryClient();
  const directory = useQuery({
    queryKey: ['classroom', 'downloadDirectory'],
    queryFn: () => classroomClient.downloadDirectory(),
  }).data;
  const choose = useMutation({
    mutationFn: () => classroomClient.chooseDownloadDirectory(),
    onSuccess: (next) => queryClient.setQueryData(['classroom', 'downloadDirectory'], next),
    onError: (error) =>
      showToast({ variant: 'error', title: '选择目录失败', description: errorMessage(error) }),
  });
  return (
    <SettingRow
      description="下载课堂录像的默认保存位置；每次下载仍可在保存对话框里改。"
      settingId="video-download-directory"
      title="视频默认下载目录"
    >
      <div className="flex items-center justify-end gap-3">
        <span className="truncate text-xs text-ink-3" title={directory || undefined}>
          {directory || '跟随系统默认'}
        </span>
        <Button
          disabled={choose.isPending}
          onClick={() => choose.mutate()}
          size="sm"
          variant="secondary"
        >
          <Folder />
          选择
        </Button>
      </div>
    </SettingRow>
  );
}
