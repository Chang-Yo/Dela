import { Megaphone } from 'lucide-react';
import { defineView } from '../../../app/module';
import { CanvasCredential } from './CanvasCredential';
import { CanvasLibrary } from './CanvasLibrary';
import { CanvasOnboardingStep } from './CanvasOnboardingStep';
import { cachedCanvasState, canvasClient } from './use-canvas';

export const canvasView = defineView({
  pages: {},
  notices: { canvas: { label: 'Canvas', icon: Megaphone } },
  settings: { credentials: CanvasCredential },
  onboarding: CanvasOnboardingStep,
  library: CanvasLibrary,
  sourceTitle: (sourceId, client) =>
    cachedCanvasState(client).items.find((item) => item.sourceId === sourceId)?.name,
  sourceOfLink(url, client) {
    const parsed = URL.parse(url);
    const file =
      parsed?.origin === 'https://oc.sjtu.edu.cn'
        ? parsed.pathname.match(/\/files\/(\d+)/)?.[1]
        : undefined;
    const sourceId = `file:${file}`;
    return file && cachedCanvasState(client).items.some((item) => item.sourceId === sourceId)
      ? sourceId
      : undefined;
  },
  officeRef: (sourceId) =>
    sourceId.startsWith('file:') ? { type: 'canvas', id: sourceId } : undefined,
  references: { queryKey: ['canvas', 'cachedFiles'], queryFn: () => canvasClient.cachedFiles() },
});
