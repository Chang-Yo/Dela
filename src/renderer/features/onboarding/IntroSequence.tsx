import { MotionConfig, motion } from 'framer-motion';
import whiteLogo from '../../../../assets/Dela_white_bg.svg';
import { OnboardingWindowBar } from './onboarding-window-bar';

// Quote 文案常量；与设置 › 关于的品牌语保持一致，要换从这一处改。
const QUOTE_TEXT = 'The world keeps changing. Dela stays with you.';

// Intro 时间线（秒）：纯白停留 → 视频溶解淡入 → 品牌从中心复现 → Quote 左→右流式 → CTA 浮现。
// 视频出现后保持低透明度继续播放，作为品牌层背后的氛围。
const blankSeconds = 0.7;
const videoFadeSeconds = 1.4;
const brandAtSeconds = 3.2;
const brandSeconds = 1.5;
const quoteAtSeconds = 4.6;
const quoteSeconds = 1.8;
const ctaAtSeconds = 6.2;
const videoDimAtSeconds = 4;

// 可选视频槽位：把成片放到 assets/intro.mp4（H.264、静音）即自动启用；
// 文件不存在时用品牌色动效占位，组件结构不变。
const introVideos = import.meta.glob<{ default: string }>('../../../../assets/intro.mp4', {
  eager: true,
});
const introVideoUrl = Object.values(introVideos)[0]?.default;

// 氛围层透明度关键帧（相对动画时间）：blank 纯白停留后开始溶解淡入 videoFade 时长，
// brand 复现起压暗至 0.28，退为品牌层背后的氛围。
const ambience = {
  delay: blankSeconds,
  duration: videoDimAtSeconds - blankSeconds,
  times: [
    0,
    videoFadeSeconds / (videoDimAtSeconds - blankSeconds),
    (brandAtSeconds - blankSeconds) / (videoDimAtSeconds - blankSeconds),
    1,
  ],
};

/** 首启引导的开场：溶解淡入的视频（或占位动效）之上，品牌、Quote 与开始按钮依次复现。 */
export function IntroSequence({ onStart }: { onStart: () => void }) {
  return (
    <MotionConfig reducedMotion="user">
      <div
        className="grid h-dvh grid-rows-[auto_1fr] bg-white text-neutral-900"
        data-onboarding-intro=""
      >
        <OnboardingWindowBar />
        <div className="relative grid place-items-center overflow-hidden pb-10">
          {/* 氛围层：视频或占位动效。先溶解淡入，品牌出现后压暗退为背景。 */}
          <motion.div
            animate={{ opacity: [0, 1, 1, 0.28] }}
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

          {/* 品牌层：Logo 与名字从中心缓缓复现，随后 Quote 自左向右流式显现。 */}
          <div className="relative flex flex-col items-center">
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              initial={{ opacity: 0, scale: 0.86 }}
              transition={{ delay: brandAtSeconds, duration: brandSeconds, ease: 'easeOut' }}
            >
              <img alt="Dela" className="h-20 w-20" src={whiteLogo} />
            </motion.div>
            <motion.h1
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 text-4xl font-semibold tracking-tight"
              initial={{ opacity: 0, y: 12 }}
              transition={{ delay: brandAtSeconds + 0.25, duration: brandSeconds, ease: 'easeOut' }}
            >
              Dela
            </motion.h1>
            <motion.p
              animate={{ clipPath: 'inset(0 0% 0 0)' }}
              className="mt-8 text-sm tracking-wide text-neutral-500"
              initial={{ clipPath: 'inset(0 100% 0 0)' }}
              transition={{ delay: quoteAtSeconds, duration: quoteSeconds, ease: 'easeInOut' }}
            >
              {QUOTE_TEXT}
            </motion.p>
          </div>

          <motion.button
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-12 rounded-full bg-neutral-900 px-7 py-2.5 text-sm text-white transition-colors hover:bg-neutral-700"
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
