import { describe, expect, it } from 'vitest';
import { tabDropZone } from '../tab-dnd';

describe('tab drop zones', () => {
  it('keeps the center and former quarter-band inside the existing group', () => {
    expect(tabDropZone(0.5, 0.5)).toBeNull();
    expect(tabDropZone(0.2, 0.5)).toBeNull();
    expect(tabDropZone(0.5, 0.8)).toBeNull();
  });

  it('splits only near the corresponding content edge', () => {
    expect(tabDropZone(0.05, 0.5)).toBe('left');
    expect(tabDropZone(0.95, 0.5)).toBe('right');
    expect(tabDropZone(0.5, 0.05)).toBe('top');
    expect(tabDropZone(0.5, 0.95)).toBe('bottom');
  });

  it('resolves corners consistently with VS Code side-by-side layout', () => {
    expect(tabDropZone(0.2, 0.05)).toBe('left');
    expect(tabDropZone(0.8, 0.95)).toBe('right');
    expect(tabDropZone(0.5, 0.1)).toBe('top');
  });
});
