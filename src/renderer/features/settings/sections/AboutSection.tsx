import { Dialog as DialogPrimitive } from 'radix-ui';
import { Feather, Heart, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { DelaBrand } from '../../../components/ui/dela-brand';
import {
  creditSections,
  type CreditPerson,
  type CreditSection,
  type SocialLink,
  type SocialLinkKind,
  type SponsorChannelKind,
} from '../credits';
import { SectionHeader } from '../SectionHeader';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';
import { cn } from '../../../lib/utils';

// lucide 不再提供品牌图标，GitHub/知乎标记内联自 simple-icons。
function GithubMark() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function ZhihuMark() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M5.721 0C2.251 0 0 2.25 0 5.719V18.28C0 21.751 2.252 24 5.721 24h12.56C21.751 24 24 21.75 24 18.281V5.72C24 2.249 21.75 0 18.281 0zm1.964 4.078c-.271.73-.5 1.434-.68 2.11h4.587c.545-.006.445 1.168.445 1.171H9.384a58.104 58.104 0 01-.112 3.797h2.712c.388.023.393 1.251.393 1.266H9.183a9.223 9.223 0 01-.408 2.102l.757-.604c.452.456 1.512 1.712 1.906 2.177.473.681.063 2.081.063 2.081l-2.794-3.382c-.653 2.518-1.845 3.607-1.845 3.607-.523.468-1.58.82-2.64.516 2.218-1.73 3.44-3.917 3.667-6.497H4.491c0-.015.197-1.243.806-1.266h2.71c.024-.32.086-3.254.086-3.797H6.598c-.136.406-.158.447-.268.753-.594 1.095-1.603 1.122-1.907 1.155.906-1.821 1.416-3.6 1.591-4.064.425-1.124 1.671-1.125 1.671-1.125zM13.078 6h6.377v11.33h-2.573l-2.184 1.373-.401-1.373h-1.219zm1.313 1.219v8.86h.623l.263.937 1.455-.938h1.456v-8.86z" />
    </svg>
  );
}

const socialLinkMeta: Record<SocialLinkKind, { icon: ReactNode; label: string }> = {
  blog: { icon: <Feather />, label: '个人博客' },
  github: { icon: <GithubMark />, label: 'GitHub 主页' },
  zhihu: { icon: <ZhihuMark />, label: '知乎' },
};

const sponsorChannelMeta: Record<SponsorChannelKind, { dotClass: string; label: string }> = {
  alipay: { dotClass: 'bg-[#1677FF]', label: '支付宝' },
  wechat: { dotClass: 'bg-[#07C160]', label: '微信' },
};

function PersonLinks({ links }: { links: SocialLink[] }) {
  return (
    <>
      {links.map(({ kind, label, url }) => {
        const meta = socialLinkMeta[kind];
        return (
          <Button asChild aria-label={label ?? meta.label} key={url} size="icon-sm" variant="ghost">
            <a href={url} rel="noreferrer" target="_blank">
              {meta.icon}
            </a>
          </Button>
        );
      })}
    </>
  );
}

function SponsorDialog({ person, trigger }: { person: CreditPerson; trigger: ReactNode }) {
  const sponsor = person.sponsor;
  if (!sponsor) return null;
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogOverlay} />
        <DialogPrimitive.Content className={cn(dialogPanel, 'w-[380px] max-w-[calc(100vw-2rem)]')}>
          <DialogPrimitive.Title className="text-base font-semibold tracking-tight">
            赞赏
          </DialogPrimitive.Title>
          {sponsor.note ? (
            <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
              {sponsor.note}
            </DialogPrimitive.Description>
          ) : null}
          <div className="mt-5 grid grid-cols-2 gap-3">
            {sponsor.channels.map(({ kind, label, qr }) => {
              const meta = sponsorChannelMeta[kind];
              return (
                <figure className="grid justify-items-center gap-2" key={kind}>
                  <div className="rounded-xl bg-white p-2.5">
                    <img
                      alt={`${label ?? meta.label}收款二维码`}
                      className="w-full rounded-lg"
                      src={qr}
                    />
                  </div>
                  <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden="true" className={`size-2 rounded-full ${meta.dotClass}`} />
                    {label ?? meta.label}
                  </figcaption>
                </figure>
              );
            })}
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
  );
}

function PersonIdentity({ person }: { person: CreditPerson }) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        alt=""
        aria-hidden="true"
        className="size-6 rounded-full object-cover"
        src={person.avatar}
      />
      <span className="text-sm font-medium text-foreground">{person.name}</span>
    </div>
  );
}

function PersonActions({ person }: { person: CreditPerson }) {
  return (
    <div className="flex items-center gap-1.5">
      {person.links ? <PersonLinks links={person.links} /> : null}
      {person.sponsor ? (
        <SponsorDialog
          person={person}
          trigger={
            <Button size="sm" variant="secondary">
              <Heart className="size-3.5" />
              赞赏
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

function CreditSectionBlock({ section }: { section: CreditSection }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-base font-semibold">{section.title}</h2>
      {section.people.map((person) => (
        <div className="flex items-center justify-between gap-3 py-1" key={person.name}>
          <PersonIdentity person={person} />
          <PersonActions person={person} />
        </div>
      ))}
    </section>
  );
}

export function AboutSection() {
  const authorSection = creditSections.find((section) => section.title === 'Author');
  const sponsorsSection = creditSections.find((section) => section.title === 'Sponsors');
  return (
    <div className="grid gap-10" data-setting-id="about">
      <SectionHeader title="关于" />
      <section className="grid justify-items-center gap-1.5 px-6 pb-10 pt-12 text-center">
        <DelaBrand className="h-48 w-48" />
        <h2 className="text-4xl font-script tracking-tight">Dela</h2>
        <p className="text-sm text-muted-foreground">
          The world keeps changing. Dela stays with you.
        </p>
        <p className="mt-5 text-xs text-muted-foreground">
          版本 {window.dela?.version ?? '浏览器预览'}
        </p>
      </section>
      {authorSection ? <CreditSectionBlock section={authorSection} /> : null}
      {sponsorsSection ? <CreditSectionBlock section={sponsorsSection} /> : null}
    </div>
  );
}
