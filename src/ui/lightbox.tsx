import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { overlayFade } from './motion';

/** 全屏看图：深色遮罩上等比展示原图，点击任意处或 Esc 关闭。src 由调用方给，
 *  data/blob/dela-resource 地址皆可；应用内图片统一的「点击放大」出口。 */
function Lightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      aria-label="图片查看"
      aria-modal="true"
      className={`fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/80 p-6 ${overlayFade}`}
      onClick={() => onClose()}
      role="dialog"
    >
      <img
        alt={alt ?? ''}
        className="max-h-full max-w-full rounded-card object-contain shadow-overlay"
        src={src}
      />
    </div>
  );
}

let mounted: { root: Root } | null = null;

/** 命令式入口：输入框图片 chip 等 React 树外的图片点击也走同一个 Lightbox；
 *  React 侧组件直接调用它，不再各自维护开关状态。重复调用只更新内容，不叠层。 */
export function openLightbox(src: string, alt?: string): void {
  if (!mounted) {
    const host = document.createElement('div');
    document.body.append(host);
    mounted = { root: createRoot(host) };
  }
  mounted.root.render(<Lightbox alt={alt} onClose={closeLightbox} src={src} />);
}

/** 主动关闭（Esc/点击遮罩之外的场景）。 */
function closeLightbox(): void {
  mounted?.root.render(null);
}
