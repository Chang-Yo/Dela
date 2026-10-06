import { useEffect, useState } from 'react';
import { MotionConfig, motion, useReducedMotion } from 'framer-motion';
import logo from '../../../../assets/Dela_Logo.png';
import { OnboardingWindowBar } from './onboarding-window-bar';
import { cn } from '../../lib/utils';

// 品牌名与 Quote 均用手写体 Italianno（--font-script）。
const QUOTE_TEXT = 'In a shallow age, refuse to float.\u00A0\u00A0\u00A0\u00A0';
const QUOTE_AUTHOR = 'ChangYo';

// Intro 时间线（秒）：Logo 浮现 → Dela 名字淡入 → Quote 左→右流式 → 署名流式 →
// 停顿约 3 秒 → CTA 浮现。动画只用透明度、位移与 clip-path 揭示——缩放插值在
// 低性能机器上易掉帧；各元素自上而下依次出现，视线单方向移动。
const logoAtSeconds = 0.35;
const logoSeconds = 1;
const nameAtSeconds = 1.2;
const nameSeconds = 0.8;
const quoteAtSeconds = 2.1;
const quoteSeconds = 1.7;
const authorAtSeconds = 4;
const authorSeconds = 0.8;
const ctaAtSeconds = 7.3;

// 可选视频槽位：把成片放到 assets/intro.mp4（H.264、静音）即自动启用；
// 文件不存在时用品牌色动效占位，组件结构不变。
const introVideos = import.meta.glob<{ default: string }>('../../../../assets/intro.mp4', {
  eager: true,
});
const introVideoUrl = Object.values(introVideos)[0]?.default;

// 氛围层透明度关键帧（相对动画时间）：blank 纯白停留后溶解淡入，品牌出现后压暗退为背景。
const ambience = {
  delay: logoAtSeconds,
  duration: 3.6,
  times: [0, 0.4, 1],
};

/** 首启引导的开场：氛围层之上，透明底 Logo、手写体品牌名与 Quote 依次复现。 */
export function IntroSequence({ onStart }: { onStart: () => void }) {
  // 动画期间就提供「跳过」，CTA 出现前不响应点击（避免隐 form 中误触、无可见反馈）。
  const reduced = useReducedMotion();
  const [ctaReady, setCtaReady] = useState(false);
  useEffect(() => {
    if (reduced) {
      setCtaReady(true);
      return;
    }
    const timer = setTimeout(() => setCtaReady(true), ctaAtSeconds * 1000);
    return () => clearTimeout(timer);
  }, [reduced]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="grid h-dvh grid-rows-[auto_1fr] bg-white text-neutral-900"
        data-onboarding-intro=""
      >
        <OnboardingWindowBar />
        {/* pb 让品牌列整体居中偏上，Logo 视觉重心落在画面上半部；矮窗口收缩留白与 Logo。 */}
        <div className="relative grid place-items-center overflow-hidden pb-[10vh] [@media(max-height:560px)]:pb-4">
          {/* 跳过动画：全程可点，不必等 CTA 出现。 */}
          <button
            className="absolute right-6 top-4 z-10 text-sm text-neutral-400 transition-colors hover:text-neutral-700"
            onClick={onStart}
            type="button"
          >
            跳过
          </button>
          {/* 氛围层：视频或占位动效。溶解淡入后压暗，退为品牌层背后的氛围。 */}
          <motion.div
            animate={{ opacity: [0, 1, 0.28] }}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            transition={{
              duration: ambience.duration,
              times: ambience.times,
              delay: ambience.delay,
              ease: 'easeInOut',
            }}
          >
            {introVideoUrl ? (
              <video
                autoPlay
                className="size-full object-cover"
                loop
                muted
                playsInline
                src={introVideoUrl}
              />
            ) : (
              <div className="absolute inset-0 overflow-hidden">
                <motion.div
                  animate={{ x: [0, 130, -50, 0], y: [0, -70, 40, 0] }}
                  className="absolute -left-36 top-1/4 size-[560px] rounded-full bg-[var(--onboarding-accent-soft)] blur-3xl"
                  transition={{ duration: 17, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div
                  animate={{ x: [0, -110, 40, 0], y: [0, 60, -40, 0] }}
                  className="absolute -right-28 bottom-0 size-[500px] rounded-full bg-neutral-200 blur-3xl"
                  transition={{ duration: 21, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div
                  animate={{ x: [0, 60, -90, 0], y: [0, 40, -60, 0] }}
                  className="absolute left-1/3 top-2/3 size-[420px] rounded-full bg-neutral-100 blur-3xl"
                  transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            )}
          </motion.div>

          {/* 品牌层：Logo 浮现，名字与 Quote 依次复现，Quote 自左向右流式显现。 */}
          <div className="relative flex flex-col items-center">
            <motion.img
              alt="Dela"
              animate={{ opacity: 1, y: 0 }}
              className="size-[180px] [@media(max-height:560px)]:size-[132px]"
              initial={{ opacity: 0, y: 14 }}
              src={logo}
              transition={{ delay: logoAtSeconds, duration: logoSeconds, ease: 'easeOut' }}
            />
            <motion.h1
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 font-script text-6xl leading-none [@media(max-height:560px)]:mt-3 [@media(max-height:560px)]:text-5xl"
              initial={{ opacity: 0, y: 10 }}
              transition={{ delay: nameAtSeconds, duration: nameSeconds, ease: 'easeOut' }}
            >
              Dela
            </motion.h1>
            {/* Quote 与署名右对齐成签名式收尾；包裹块由外层列居中。 */}
            <div className="flex flex-col items-end">
              <motion.p
                animate={{ clipPath: 'inset(0 0% 0 0)' }}
                className="mt-4 font-script text-3xl text-neutral-600"
                initial={{ clipPath: 'inset(0 100% 0 0)' }}
                transition={{ delay: quoteAtSeconds, duration: quoteSeconds, ease: 'easeInOut' }}
              >
                {QUOTE_TEXT}
              </motion.p>
              <motion.p
                animate={{ clipPath: 'inset(0 0% 0 0)' }}
                className="mt-1 font-script text-2xl text-neutral-800"
                initial={{ clipPath: 'inset(0 100% 0 0)' }}
                transition={{ delay: authorAtSeconds, duration: authorSeconds, ease: 'easeInOut' }}
              >
                — {QUOTE_AUTHOR}
              </motion.p>
            </div>
          </div>

          <motion.button
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'absolute bottom-12 rounded-full bg-neutral-900 px-7 py-2.5 text-sm text-white transition-colors hover:bg-neutral-700 [@media(max-height:560px)]:bottom-6',
              !ctaReady && 'pointer-events-none',
            )}
            initial={{ opacity: 0, y: 10 }}
            onClick={onStart}
            transition={{ delay: ctaAtSeconds, duration: 0.7, ease: 'easeOut' }}
            type="button"
          >
            开始配置个人资料
          </motion.button>
        </div>
      </div>
    </MotionConfig>
  );
}
