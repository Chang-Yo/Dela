import { useEffect, useRef } from 'react';
import { MotionConfig, motion } from 'framer-motion';

// 时间线（秒）：两行大标题错峰淡入 → 停留 → 整层淡出交还主界面。
// 只用透明度与位移，不用缩放。
const line1AtSeconds = 0.3;
const line2AtSeconds = 0.55;
const lineSeconds = 0.7;
const fadeAtSeconds = 2.9;
const fadeSeconds = 1;

/** 引导完成的收尾动画：居中大标题显现后整层淡出，交还其下已挂载的主界面。
 *  点击或按任意键可立即跳过，不必等动画播完。 */
export function CompletionOverlay({ onFinished }: { onFinished: () => void }) {
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  useEffect(() => {
    const timer = window.setTimeout(
      () => finishedRef.current(),
      (fadeAtSeconds + fadeSeconds) * 1000,
    );
    const skip = () => finishedRef.current();
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        animate={{ opacity: 0 }}
        className="fixed inset-0 z-[60] grid place-items-center bui-light bg-surface text-ink"
        data-onboarding-completion=""
        initial={{ opacity: 1 }}
        transition={{ delay: fadeAtSeconds, duration: fadeSeconds, ease: 'easeOut' }}
      >
        <h1 className="px-8 text-center text-4xl leading-snug font-bold tracking-tight">
          <motion.span
            animate={{ opacity: 1, y: 0 }}
            className="block"
            initial={{ opacity: 0, y: 10 }}
            transition={{ delay: line1AtSeconds, duration: lineSeconds, ease: 'easeOut' }}
          >
            The world keeps changing,
          </motion.span>
          <motion.span
            animate={{ opacity: 1, y: 0 }}
            className="block"
            initial={{ opacity: 0, y: 10 }}
            transition={{ delay: line2AtSeconds, duration: lineSeconds, ease: 'easeOut' }}
          >
            Dela always stays with you
          </motion.span>
        </h1>
      </motion.div>
    </MotionConfig>
  );
}
