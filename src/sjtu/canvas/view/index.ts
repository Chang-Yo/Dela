import { Megaphone } from 'lucide-react';
import { defineView } from '../../../app/module';
import { CANVAS_SOURCE_PREFIX } from '../contract';
import { CanvasCredential } from './CanvasCredential';
import { CanvasLibrary } from './CanvasLibrary';
import { CanvasOnboardingStep } from './CanvasOnboardingStep';
import { cachedCanvasState, canvasClient } from './use-canvas';

export const canvasView = defineView({
  pages: {},
  notices: { canvas: { label: 'Canvas', icon: Megaphone } },
  settings: { credentials: CanvasCredential },
  onboarding: CanvasOnboardingStep,
  sources: {
    prefix: CANVAS_SOURCE_PREFIX,
    title: (sourceId, client) =>
      cachedCanvasState(client).items.find((item) => item.sourceId === sourceId)?.name,
    fromLink(url, client) {
      const parsed = URL.parse(url);
      const file =
        parsed?.origin === 'https://oc.sjtu.edu.cn'
          ? parsed.pathname.match(/\/files\/(\d+)/)?.[1]
          : undefined;
      const sourceId = `canvas-file:${file}`;
      return file && cachedCanvasState(client).items.some((item) => item.sourceId === sourceId)
        ? sourceId
        : undefined;
    },
    library: CanvasLibrary,
    references: { queryKey: ['canvas', 'cachedFiles'], queryFn: () => canvasClient.cachedFiles() },
  },
});
