// 瞬时动作结果（打开目录失败、条目操作失败等）任意模块直接调 showToast()；
// 持久状态（工作区镜像加载失败、表单校验）不经过这里，仍内联展示。
import { create } from 'zustand';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ToastCard, type ToastVariant } from '../components/ui/beautifului/atoms/Toast';

export interface ToastItem {
  id: number;
  /** neutral：没有成败之分的消息（如 Pi 扩展的通知）。 */
  variant: ToastVariant | 'neutral';
  title: string;
  description?: string;
}

const MAX_TOASTS = 4;
// 错误需要读的时间长一些；成功一瞥即走。
const TTL_MS: Record<ToastItem['variant'], number> = { error: 8000, success: 4000, neutral: 6000 };

const timers = new Map<number, ReturnType<typeof setTimeout>>();

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

let pulseSeq = 0;

type Store = {
  toasts: ToastItem[];
  push(toast: Omit<ToastItem, 'id'>): void;
  dismiss(id: number): void;
};

export const useToastStore = create<Store>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = ++pulseSeq;
    set((state) => {
      const next = [...state.toasts, { id, ...toast }];
      // 超出上限丢最旧，避免持续失败刷屏。
      const dropped = next.length > MAX_TOASTS ? next.splice(0, next.length - MAX_TOASTS) : [];
      for (const item of dropped) clearTimer(item.id);
      return { toasts: next };
    });
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), TTL_MS[toast.variant]),
    );
  },
  dismiss: (id) => {
    clearTimer(id);
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
  },
}));

/** 组件外的命令式入口。 */
export function showToast(toast: Omit<ToastItem, 'id'>) {
  useToastStore.getState().push(toast);
}

/** 钉在 AppShell 的 main#app-main 末尾。App 的 MotionConfig 盖不到这里，降低动效要单独声明。 */
export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <MotionConfig reducedMotion="user">
      <div
        data-toast-host=""
        className="pointer-events-none absolute inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-4 pt-3"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              <ToastCard
                variant={toast.variant}
                title={toast.title}
                description={toast.description}
                onClose={() => dismiss(toast.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
