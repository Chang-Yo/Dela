import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { CredentialRow } from '../../../modules/settings/view';
import { Button } from '../../../ui/button';
import { CanvasConnectDialog } from './CanvasConnectDialog';
import { useCanvasState } from './use-canvas';

export function CanvasCredential() {
  const { connected } = useCanvasState();
  const [dialog, setDialog] = useState(false);
  return (
    <CredentialRow
      connected={connected}
      icon={GraduationCap}
      name="Canvas"
      settingId="canvas"
      status={connected ? '已连接' : '未连接'}
    >
      <Button className="shrink-0" onClick={() => setDialog(true)} size="sm" variant="secondary">
        {connected ? '管理' : '配置'}
      </Button>
      {dialog && <CanvasConnectDialog onClose={() => setDialog(false)} />}
    </CredentialRow>
  );
}
