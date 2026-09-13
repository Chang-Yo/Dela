import { Dialog as DialogPrimitive } from 'radix-ui';
import { Heart, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { DelaBrand } from '../../components/ui/dela-brand';
import alipayQr from '../../../../assets/Alipay.png';
import authorAvatar from '../../../../assets/author_avatar_square.jpg';
import wechatQr from '../../../../assets/Wechat.png';
import { SectionHeader } from './SectionHeader';

const REPO_URL = 'https://github.com/Chang-Yo/Dela';

const sponsorChannels = [
  { label: '微信', dotClass: 'bg-[#07C160]', qrAlt: '微信收款二维码', qrSrc: wechatQr },
  { label: '支付宝', dotClass: 'bg-[#1677FF]', qrAlt: '支付宝收款二维码', qrSrc: alipayQr },
];

// lucide 不再提供品牌图标，GitHub 标记内联自 simple-icons。
function GithubMark() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function AboutSection() {
  return (
    <div className="grid gap-5">
      <SectionHeader title="关于" />
      <section className="grid justify-items-center gap-1.5 px-6 pb-10 pt-12 text-center">
        <DelaBrand className="mb-6 h-48 w-48" />
        <h2 className="text-2xl font-semibold tracking-tight">Dela</h2>
        <p className="text-sm text-muted-foreground">If MySJTU can do it, so can Dela!</p>
        <p className="mt-5 text-xs text-muted-foreground">
          版本 {window.dela?.version ?? '浏览器预览'}
        </p>
      </section>
      <footer className="flex items-center justify-between gap-3 border-t pt-5">
        <div className="flex items-center gap-2.5">
          <img
            alt=""
            aria-hidden="true"
            className="size-6 rounded-full object-cover"
            src={authorAvatar}
          />
          <span className="text-sm text-muted-foreground">
            author: <span className="font-medium text-foreground">ChangYo</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button asChild aria-label="GitHub 仓库" size="icon-sm" variant="ghost">
            <a href={REPO_URL} rel="noreferrer" target="_blank">
              <GithubMark />
            </a>
          </Button>
          <DialogPrimitive.Root>
            <DialogPrimitive.Trigger asChild>
              <Button size="sm" variant="secondary">
                <Heart className="size-3.5" />
                赞赏
              </Button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
              <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[380px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-popover p-6 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
                <DialogPrimitive.Title className="text-base font-semibold tracking-tight">
                  赞赏
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
                  请作者喝一杯
                </DialogPrimitive.Description>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {sponsorChannels.map(({ dotClass, label, qrAlt, qrSrc }) => (
                    <figure className="grid justify-items-center gap-2" key={label}>
                      <div className="rounded-xl bg-white p-2.5">
                        <img alt={qrAlt} className="w-full rounded-lg" src={qrSrc} />
                      </div>
                      <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span aria-hidden="true" className={`size-2 rounded-full ${dotClass}`} />
                        {label}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <DialogPrimitive.Close asChild>
                  <Button
                    aria-label="关闭"
                    className="absolute right-3 top-3 text-muted-foreground"
                    size="icon-sm"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </DialogPrimitive.Close>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </div>
      </footer>
    </div>
  );
}
