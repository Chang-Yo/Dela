import { useEffect } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import { CalendarDays, GraduationCap, Mail, Sparkles } from 'lucide-react';
import whiteLogo from '../../../../assets/Dela_white_bg.svg';
import { ShuiyuanIcon } from '../../components/ui/shuiyuan-icon';

const readyFeatures = [
  { icon: Mail, label: '邮箱' },
  { icon: CalendarDays, label: '课表' },
  { icon: GraduationCap, label: 'Canvas' },
  { icon: ShuiyuanIcon, label: '水源' },
  { icon: Sparkles, label: '模型' },
];

// 时间线（秒）：Logo 复现 → 「一切就绪」→ 能力点依次点亮 → 停留 → 整层淡出交还主界面。
const logoAt = 0.2;
const titleAt = 0.8;
const chipAt = 1.3;
const chipStaggerSeconds = 0.22;
const fadeAtSeconds = 3.6;
const fadeSeconds = 0.9;

/** 引导完成的收尾动画：在已挂载的主界面之上从纯白渐隐，营造「一切就绪」的期待感。 */
export function CompletionOverlay({ onFinished }: { onFinished: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onFinished, (fadeAtSeconds + fadeSeconds) * 1000);
    return () => window.clearTimeout(timer);
  }, [onFinished]);

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        animate={{ opacity: 0 }}
        className="fixed inset-0 z-[60] grid place-items-center bg-white text-neutral-900"
        data-onboarding-completion=""
        initial={{ opacity: 1 }}
        transition={{ delay: fadeAtSeconds, duration: fadeSeconds, ease: 'easeOut' }}
      >
        <div className="flex flex-col items-center">
          <motion.img
            alt=""
            animate={{ opacity: 1, scale: 1 }}
            aria-hidden="true"
            className="h-20 w-20"
            initial={{ opacity: 0, scale: 0.88 }}
            src={whiteLogo}
            transition={{ delay: logoAt, duration: 1.1, ease: 'easeOut' }}
          />
          <motion.h1
            animate={{ opacity: 1, y: 0 }}
            className="mt-7 text-2xl font-semibold tracking-tight"
            initial={{ opacity: 0, y: 10 }}
            transition={{ delay: titleAt, duration: 0.7, ease: 'easeOut' }}
          >
            一切就绪
          </motion.h1>
          <div className="mt-9 flex items-start gap-6">
            {readyFeatures.map(({ icon: Icon, label }, index) => (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-2"
                initial={{ opacity: 0, y: 8 }}
                key={label}
                transition={{
                  delay: chipAt + index * chipStaggerSeconds,
                  duration: 0.5,
                  ease: 'easeOut',
                }}
              >
                <span className="grid size-11 place-items-center rounded-xl bg-[var(--onboarding-accent-soft)] text-[var(--onboarding-accent)]">
                  <Icon className="size-5" strokeWidth={1.8} />
                </span>
                <span className="text-xs text-neutral-500">{label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </MotionConfig>
  );
}
