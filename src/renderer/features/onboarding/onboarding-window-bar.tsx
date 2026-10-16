import type { ReactNode } from 'react';
import { Minus, X } from 'lucide-react';
import { platform } from '../../lib/platform';

/**
 * 引导期间的窗口栏：titleBarStyle hidden 下 AppShell 标题栏不存在，
 * 这里提供拖拽区与最小化/关闭，避免用户被全屏引导页困住。配色固定，不随主题。
 */
export function OnboardingWindowBar({ children }: { children?: ReactNode }) {
  return (
    <div className="relative z-10 flex h-12 shrink-0 items-center justify-end [-webkit-app-region:drag]">
      {children && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      )}
      <div className="flex h-full [-webkit-app-region:no-drag]">
        {window.dela && platform !== 'mac' && (
          <>
            <button
              aria-label="最小化"
              className="grid h-full w-12 place-items-center text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
              onClick={() => window.dela?.window.minimize()}
              type="button"
            >
              <Minus className="size-4" strokeWidth={1.8} />
            </button>
            <button
              aria-label="关闭"
              className="grid h-full w-12 place-items-center text-ink-3 transition-colors hover:bg-[#e81123] hover:text-white"
              onClick={() => window.dela?.window.close()}
              type="button"
            >
              <X className="size-4" strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
