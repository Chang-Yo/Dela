import { describe, expect, it } from 'vitest';
import { remoteAccent } from './remote-color';

describe('远端连接的取色', () => {
  it('同一个连接恒定同色，且取的是主题里已有的调色板', () => {
    const first = remoteAccent('d3f1a1c2-0000-4000-8000-000000000000');
    expect(remoteAccent('d3f1a1c2-0000-4000-8000-000000000000')).toBe(first);
    expect(first).toMatch(/^var\(--cal-[a-z]+-text\)$/);
    expect(remoteAccent('d3f1a1c2-0000-4000-8000-000000000000', 'bg')).toMatch(
      /^var\(--cal-[a-z]+-bg\)$/,
    );
  });

  it('没有连接时退回中性色', () => {
    expect(remoteAccent(null)).toBe('var(--ink-3)');
    expect(remoteAccent(undefined, 'bg')).toBe('var(--field)');
  });
});
