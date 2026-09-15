import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { DelaBrand } from '../../components/ui/dela-brand';

// 首次启动的开屏动画只展示一次；与主题、字号等界面状态一致保存在 localStorage。
const seenStorageKey = 'dela.splash.seen';

// 冒烟与自动化由 main 或各 smoke 脚本在页面 URL 上注入该参数，跳过一次性界面。
const isSmokeTest = new URLSearchParams(window.location.search).has('smoke-test');

// 开屏时间线（秒）：logo 弹入 -> 名称淡入 -> 分隔线展开 -> 标语淡入，随后整层放大淡出。
const logoDelay = 0.15;
const nameDelay = 0.5;
const lineDelay = 0.8;
const taglineDelay = 1.05;
const autoDismissSeconds = 2.4;

function shouldShowSplash() {
  return !isSmokeTest && localStorage.getItem(seenStorageKey) === null;
}

export function FirstLaunchSplash() {
  const [open, setOpen] = useState(shouldShowSplash);

  const dismiss = useCallback(() => {
    localStorage.setItem(seenStorageKey, '1');
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(dismiss, autoDismissSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [open, dismiss]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dismiss]);

  return (
    <AnimatePresence>
      {open && (
        // 该层渲染在 App 的 MotionConfig 之外，需自带 reducedMotion 以尊重系统设置。
        <MotionConfig reducedMotion="user">
          <motion.div
            className="fixed inset-0 z-[60] grid select-none place-items-center bg-background"
            data-splash=""
            exit={{ opacity: 0, scale: 1.04 }}
            onClick={dismiss}
            transition={{ duration: 0.42, ease: 'easeOut' }}
          >
            <div className="flex flex-col items-center">
              <motion.div
                animate={{ opacity: 1, scale: 1 }}
                initial={{ opacity: 0, scale: 0.72 }}
                transition={{ delay: logoDelay, type: 'spring', stiffness: 220, damping: 18 }}
              >
                <DelaBrand className="h-24 w-24" />
              </motion.div>
              <motion.h1
                animate={{ opacity: 1, y: 0 }}
                className="mt-7 text-3xl font-semibold tracking-tight"
                initial={{ opacity: 0, y: 10 }}
                transition={{ delay: nameDelay, duration: 0.5, ease: 'easeOut' }}
              >
                Dela
              </motion.h1>
              <motion.div
                animate={{ scaleX: 1 }}
                className="mt-6 h-px w-14 origin-center bg-foreground/20"
                initial={{ scaleX: 0 }}
                transition={{ delay: lineDelay, duration: 0.45, ease: 'easeOut' }}
              />
              <motion.p
                animate={{ opacity: 1, y: 0 }}
                className="mt-5 max-w-xs text-balance text-center text-sm text-muted-foreground"
                initial={{ opacity: 0, y: 8 }}
                transition={{ delay: taglineDelay, duration: 0.5, ease: 'easeOut' }}
              >
                The world keeps changing. Dela stays with you.
              </motion.p>
            </div>
          </motion.div>
        </MotionConfig>
      )}
    </AnimatePresence>
  );
}
