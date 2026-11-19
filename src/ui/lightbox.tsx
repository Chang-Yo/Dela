import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { overlayFade } from './motion';

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
      className={`fixed inset-0 z-overlay grid cursor-zoom-out place-items-center bg-media/80 p-6 ${overlayFade}`}
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

/** React 树外的图片点击也走同一个 Lightbox；重复调用只更新内容，不叠层。 */
export function openLightbox(src: string, alt?: string): void {
  if (!mounted) {
    const host = document.createElement('div');
    document.body.append(host);
    mounted = { root: createRoot(host) };
  }
  mounted.root.render(<Lightbox alt={alt} onClose={closeLightbox} src={src} />);
}

function closeLightbox(): void {
  mounted?.root.render(null);
}
