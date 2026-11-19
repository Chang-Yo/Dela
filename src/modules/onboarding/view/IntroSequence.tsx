import { useEffect, useState } from 'react';
import logo from '../../../../assets/Dela_Logo.png';
import { HandwritingLine } from './intro-handwriting';
import { OnboardingWindowBar } from './onboarding-window-bar';
import { cn } from '../../../ui/cn';
import { Button } from '../../../ui/button';
import { useMediaQuery } from '../../../ui/use-media-query';

const introVideos = import.meta.glob<{ default: string }>(
  '../../../../assets/onboarding-video.webm',
  {
    eager: true,
  },
);
const introVideoUrl = Object.values(introVideos)[0]?.default;

const videoFadeSeconds = 0.6;
const logoAtSeconds = 3.2;
const logoSeconds = 0.7;
const nameAtSeconds = 4.2;
const quoteAtSeconds = 5.2;
const authorAtSeconds = 7.6;
const ctaAtSeconds = 8.9;
const ctaSeconds = 0.6;
const leaveSeconds = 0.35;

export function IntroSequence({ onStart }: { onStart: () => void }) {
  // 动画期间就提供「跳过」，CTA 出现前不响应点击（避免隐 form 中误触、无可见反馈）。
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [ctaTimerDone, setCtaTimerDone] = useState(false);
  const ctaReady = reduced || ctaTimerDone;
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => setCtaTimerDone(true), ctaAtSeconds * 1000);
    return () => clearTimeout(timer);
  }, [reduced]);

  const leave = () => (reduced ? onStart() : setLeaving(true));

  return (
    <div
      className={cn(
        'relative grid h-dvh grid-rows-[auto_1fr] bui-light bg-surface text-ink',
        leaving && 'animate-fade-out',
      )}
      data-onboarding-intro=""
      // 淡出结束后才切给向导，避免开场被直接抽走。
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onStart();
      }}
      style={{ animationDuration: `${leaveSeconds}s` }}
    >
      <div
        className="pointer-events-none absolute inset-0 animate-fade-in overflow-hidden motion-reduce:animate-none"
        style={{ animationDuration: `${videoFadeSeconds}s` }}
      >
        {introVideoUrl && (
          <video
            autoPlay
            className="size-full object-cover"
            loop
            muted
            playsInline
            src={introVideoUrl}
          />
        )}
        <div className="absolute inset-0 animate-blur-deepen backdrop-blur-md motion-reduce:animate-none" />
      </div>

      <OnboardingWindowBar />
      <div className="relative grid place-items-center overflow-hidden pb-[10vh] [@media(max-height:560px)]:pb-4">
        <Button className="absolute right-6 top-4 z-10 text-ink-3" onClick={leave} variant="ghost">
          跳过
        </Button>

        <div className="relative flex flex-col items-center">
          <img
            alt="Dela"
            className="size-45 animate-rise-in motion-reduce:animate-none [@media(max-height:560px)]:size-33"
            src={logo}
            style={{
              animationDelay: `${logoAtSeconds}s`,
              animationDuration: `${logoSeconds}s`,
              ...{ '--rise-distance': '14px' },
            }}
          />
          <HandwritingLine
            charDelay={0.2}
            className="mt-6 font-script text-6xl text-ink [@media(max-height:560px)]:mt-3 [@media(max-height:560px)]:text-5xl"
            delay={nameAtSeconds}
            duration={0.5}
            line="name"
          />
          <div className="mt-10 flex flex-col items-end gap-1.5">
            <HandwritingLine
              charDelay={0.06}
              className="font-script text-3xl text-ink"
              delay={quoteAtSeconds}
              duration={0.42}
              line="quote"
            />
            <HandwritingLine
              charDelay={0.09}
              className="font-script text-2xl text-ink"
              delay={authorAtSeconds}
              duration={0.4}
              line="author"
            />
          </div>
        </div>

        <button
          className={cn(
            'absolute bottom-12 animate-rise-in rounded-full bg-ink px-7 py-2.5 text-sm text-surface transition-colors hover:opacity-90 motion-reduce:animate-none [@media(max-height:560px)]:bottom-6',
            !ctaReady && 'pointer-events-none',
          )}
          onClick={leave}
          style={{
            animationDelay: `${ctaAtSeconds}s`,
            animationDuration: `${ctaSeconds}s`,
          }}
          type="button"
        >
          开始配置个人资料
        </button>
      </div>
    </div>
  );
}
