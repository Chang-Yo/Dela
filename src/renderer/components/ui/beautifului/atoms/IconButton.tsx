"use client";

import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/* Dela 适配新增（上游无此文件）：从 PromptBar 控件按钮提炼的静默图标钮。
 * 常态无边无底，悬浮显 bg-hover，按压微缩；用于工具栏与消息操作行。 */
export function IconButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        `flex size-7 shrink-0 items-center justify-center rounded-control text-ink-3
         transition-[background-color,color,transform] duration-150
         hover:bg-hover hover:text-ink active:scale-[0.94]
         disabled:pointer-events-none disabled:opacity-50
         [&_svg]:size-4`,
        className,
      )}
      {...props}
    />
  );
}
