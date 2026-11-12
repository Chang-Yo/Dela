import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// 自定义的字号、圆角与缓动 token 要登记进来，否则 twMerge 认不出它们的类别：
// text-13 会被当作文字颜色，遇到 text-ink-3 就被删掉。
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['9', '10', '13', '15', '21', '2xs'],
      radius: ['chip', 'control', 'card', 'window'],
      ease: ['out-strong', 'in-out-strong', 'link'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
