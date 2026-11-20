import { Dialog as DialogPrimitive } from 'radix-ui';
import { create } from 'zustand';
import { overlayFade } from './lib/motion';

const useLightboxStore = create<{ image: { src: string; alt?: string } | null }>(() => ({
  image: null,
}));

/** React 树外的图片点击也走同一个 Lightbox；重复调用只更新内容，不叠层。 */
function openLightbox(src: string, alt?: string): void {
  useLightboxStore.setState({ image: { src, alt } });
}

function closeLightbox(): void {
  useLightboxStore.setState({ image: null });
}

function Lightbox() {
  const image = useLightboxStore((state) => state.image);
  return (
    <DialogPrimitive.Root
      open={image !== null}
      onOpenChange={(open) => {
        if (!open) closeLightbox();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          aria-label="图片查看"
          className={`fixed inset-0 z-overlay grid cursor-zoom-out place-items-center bg-media/80 p-6 outline-none ${overlayFade}`}
          data-slot="lightbox"
          onClick={closeLightbox}
        >
          <DialogPrimitive.Title className="sr-only">图片查看</DialogPrimitive.Title>
          {image && (
            <img
              alt={image.alt ?? ''}
              className="max-h-full max-w-full rounded-card object-contain shadow-overlay"
              src={image.src}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { Lightbox, openLightbox };
