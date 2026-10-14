"use client";

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";

export type ToastVariant = "error" | "success";

/* Dela 适配新增（上游无此文件）：应用内通知浮窗卡片。
 * 纯展示：文案、变体与关闭回调由调用方传入（宿主见 app/toasts.tsx），库不持有状态。
 * 外观遵循库浮岛惯例：rounded-card + hairline 阴影（shadow-overlay），语义 tint 圆底图标。 */

const tone = {
  error: { icon: CircleAlert, badge: "bg-red-tint text-red", role: "alert" },
  success: { icon: CircleCheck, badge: "bg-green-tint text-green", role: "status" },
} as const;

export function ToastCard({
  variant,
  title,
  description,
  onClose,
  className,
}: {
  variant: ToastVariant;
  title: string;
  description?: string;
  onClose: () => void;
  className?: string;
}) {
  const { icon: Icon, badge, role } = tone[variant];
  return (
    <div
      role={role}
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
      </div>
      <IconButton aria-label="关闭通知" onClick={onClose} className="-mt-0.5">
        <X />
      </IconButton>
    </div>
  );
}
