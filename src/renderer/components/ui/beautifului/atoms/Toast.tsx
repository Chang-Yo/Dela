"use client";

import { CircleAlert, CircleCheck, Sparkles, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";

export type ToastVariant = "error" | "success";

/* Dela 适配新增（上游无此文件）：应用内通知浮窗卡片。
 * 纯展示：文案、变体与关闭回调由调用方传入（宿主见 app/toasts.tsx），库不持有状态。
 * 外观遵循库浮岛惯例：rounded-card + hairline 阴影（shadow-overlay），语义 tint 圆底图标。 */

const tone = {
  error: { icon: CircleAlert, badge: "bg-red-tint text-red", role: "alert" },
  success: { icon: CircleCheck, badge: "bg-green-tint text-green", role: "status" },
  neutral: { icon: Sparkles, badge: "bg-inset text-ink-2", role: "group" },
} as const;

export function ToastCard({
  variant,
  title,
  description,
  onClose,
  className,
  icon,
  action,
  children,
}: {
  variant: ToastVariant | "neutral";
  title: string;
  description?: string;
  onClose?: () => void;
  className?: string;
  /** Dela 适配：能力拓展复用通知卡片，右侧操作和正文下方进度由调用方提供。 */
  icon?: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { badge, role } = tone[variant];
  const Icon = icon ?? tone[variant].icon;
  return (
    <div
      role={role}
      aria-label={variant === "neutral" ? title : undefined}
      className={cn(
        `pointer-events-auto flex w-96 max-w-full items-start gap-2.5 rounded-card
         border border-line bg-surface py-3 pl-3 pr-2 shadow-overlay`,
        className,
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          badge,
        )}
      >
        <Icon aria-hidden className="size-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-13 font-medium leading-5 text-ink">{title}</p>
        {description && (
          <p className="mt-0.5 break-words text-xs leading-[1.45] text-ink-2">
            {description}
          </p>
        )}
        {children}
      </div>
      {action}
      {onClose && (
        <IconButton aria-label="关闭通知" onClick={onClose} className="-mt-0.5">
          <X />
        </IconButton>
      )}
    </div>
  );
}
