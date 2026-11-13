import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// 自定义的圆角、阴影、缓动、层级与时长 token 要登记进来，否则 twMerge 认不出它们的类别，
// 会把同类的两个类名都留下。
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['chip', 'control', 'card', 'window'],
      shadow: [
        'hairline',
        'hairline-strong',
        'focus',
        'invalid',
        'tooltip',
        'thumb',
        'inset-highlight',
        'btn',
        'card',
        'raised',
        'overlay',
      ],
      ease: ['out-strong'],
    },
    classGroups: {
      z: [{ z: ['drawer', 'scrim', 'overlay', 'takeover', 'toast'] }],
      duration: [{ duration: ['fast', 'base', 'slow', 'slower'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
