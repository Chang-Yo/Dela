import { describe, expect, it } from 'vitest';
import {
  acceleratorFromEvent,
  defaultKeybindings,
  findShortcutConflicts,
  isAccelerator,
  matchShortcut,
  mergeKeybindings,
  type KeyEventLike,
} from '../keybindings';

function key(value: string, modifiers: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe('acceleratorFromEvent', () => {
  it('修饰键按 Mod+Alt+Shift 顺序规范化，字母转大写', () => {
    expect(acceleratorFromEvent(key('n', { ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+N');
    expect(acceleratorFromEvent(key('z', { altKey: true }))).toBe('Alt+Z');
    expect(acceleratorFromEvent(key('k', { metaKey: true }), 'mac')).toBe('Mod+K');
  });

  it('命名键与标点沿用既有写法，空格与加号归一', () => {
    expect(acceleratorFromEvent(key('PageDown', { ctrlKey: true }))).toBe('Mod+PageDown');
    expect(acceleratorFromEvent(key(',', { ctrlKey: true }))).toBe('Mod+,');
    expect(acceleratorFromEvent(key(' '))).toBe('Space');
    expect(acceleratorFromEvent(key('+', { ctrlKey: true }))).toBe('Mod+=');
  });
});

describe('isAccelerator', () => {
  it('接受规范键位串、拒绝小写与未知命名键', () => {
    expect(isAccelerator('Mod+Shift+N')).toBe(true);
    expect(isAccelerator('Alt+PageUp')).toBe(true);
    expect(isAccelerator('Mod+n')).toBe(false);
    expect(isAccelerator('Meta+N')).toBe(false);
    expect(isAccelerator('')).toBe(false);
    expect(isAccelerator(7)).toBe(false);
  });
});

describe('mergeKeybindings', () => {
  it('默认值叠加覆盖项，null 表示解绑，未知名忽略', () => {
    const merged = mergeKeybindings({ 'global-search': 'Mod+P', 'close-tab': null });
    expect(merged['global-search']).toBe('Mod+P');
    expect(merged['close-tab']).toBeNull();
    expect(merged['zoom-in']).toBe(defaultKeybindings()['zoom-in']);
    expect(Object.keys(mergeKeybindings({ notAnAction: 'Mod+Q' } as never))).not.toContain(
      'notAnAction',
    );
  });
});

describe('matchShortcut 与 digit 族', () => {
  const bindings = mergeKeybindings({});

  it('命中绑定的组合，未绑定或未命中返回 null', () => {
    expect(matchShortcut(bindings, key('k', { ctrlKey: true }), 'global')).toBe('global-search');
    expect(matchShortcut(bindings, key('k'), 'global')).toBeNull();
    expect(matchShortcut(bindings, key('w', { ctrlKey: true }), 'global')).toBeNull();
  });

  it('作用域隔离：工作台动作不在全局作用域命中', () => {
    expect(matchShortcut(bindings, key('w', { ctrlKey: true }), 'workbench')).toBe('close-tab');
    expect(matchShortcut(bindings, key('\\', { ctrlKey: true }), 'workbench')).toBe('split-right');
  });

  it('digit 族接受 1…9，修饰键必须一致', () => {
    expect(matchShortcut(bindings, key('5', { altKey: true }), 'workbench')).toBe('focus-group');
    expect(
      matchShortcut(bindings, key('5', { altKey: true, shiftKey: true }), 'workbench'),
    ).toBeNull();
    // macOS 上 Alt+数字输入的是别的字符，此时按物理键判定。
    expect(
      matchShortcut(bindings, { ...key('¡', { altKey: true }), code: 'Digit3' }, 'workbench'),
    ).toBe('focus-group');
  });
});

describe('macOS 键位语义', () => {
  const bindings = defaultKeybindings();

  it('⌘ 匹配 Mod，Control 留给终端与原生文本编辑', () => {
    expect(matchShortcut(bindings, key('k', { metaKey: true }), 'global', 'mac')).toBe(
      'global-search',
    );
    expect(matchShortcut(bindings, key('k', { ctrlKey: true }), 'global', 'mac')).toBeNull();
    expect(matchShortcut(bindings, key('w', { ctrlKey: true }), 'workbench', 'mac')).toBeNull();
    expect(matchShortcut(bindings, key('w', { metaKey: true }), 'workbench', 'mac')).toBe(
      'close-tab',
    );
    expect(
      matchShortcut(bindings, key('k', { metaKey: true, ctrlKey: true }), 'global', 'mac'),
    ).toBeNull();
  });

  it('Control 可以单独录制，与 ⌘ 分开持久化和显示', () => {
    const accelerator = acceleratorFromEvent(key('k', { ctrlKey: true }), 'mac');
    expect(accelerator).toBe('Ctrl+K');
    expect(isAccelerator(accelerator)).toBe(true);
    const custom = mergeKeybindings({ 'global-search': accelerator });
    expect(matchShortcut(custom, key('k', { ctrlKey: true }), 'global', 'mac')).toBe(
      'global-search',
    );
    expect(matchShortcut(custom, key('k', { metaKey: true }), 'global', 'mac')).toBeNull();
  });

  it('Option 的字符变化不破坏字母和数字快捷键，组合输入不触发动作', () => {
    expect(
      matchShortcut(bindings, { ...key('Ω', { altKey: true }), code: 'KeyZ' }, 'global', 'mac'),
    ).toBe('toggle-word-wrap');
    expect(acceleratorFromEvent({ ...key('¡', { altKey: true }), code: 'Digit1' }, 'mac')).toBe(
      'Alt+1',
    );
    expect(
      matchShortcut(
        bindings,
        { ...key('k', { metaKey: true }), isComposing: true },
        'global',
        'mac',
      ),
    ).toBeNull();
  });
});

describe('findShortcutConflicts', () => {
  it('同一键位被两个动作占用即冲突', () => {
    const conflicts = findShortcutConflicts(mergeKeybindings({ 'global-search': 'Mod+O' }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.actionIds).toEqual(['import-files', 'global-search']);
  });

  it('默认键位表本身无冲突', () => {
    expect(findShortcutConflicts(defaultKeybindings())).toEqual([]);
  });
});
