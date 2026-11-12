import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('自定义字号与文字颜色共存，同类 token 后者覆盖前者', () => {
    expect(cn('text-13 text-ink-3')).toBe('text-13 text-ink-3');
    expect(cn('text-13', 'text-xs')).toBe('text-xs');
    expect(cn('rounded-control', 'rounded-card')).toBe('rounded-card');
  });

  it('自定义阴影、层级与时长 token 按同类覆盖', () => {
    expect(cn('shadow-hairline', 'shadow-focus')).toBe('shadow-focus');
    expect(cn('z-drawer', 'z-overlay')).toBe('z-overlay');
    expect(cn('duration-fast', 'duration-slow')).toBe('duration-slow');
  });
});
