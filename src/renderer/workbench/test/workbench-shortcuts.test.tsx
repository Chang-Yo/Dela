// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultKeybindings } from '../../../shared/keybindings';

const state = vi.hoisted(() => ({ platform: 'mac', closeTab: vi.fn() }));
vi.mock('../../lib/platform', () => ({
  get platform() {
    return state.platform;
  },
}));
const layout = {
  ready: true,
  root: { type: 'group', id: 'group', tabs: ['note'], active: 'note' },
  focus: 'group',
  maximized: null,
  closeTab: state.closeTab,
};
vi.mock('../layout-store', () => ({
  useWorkbenchLayout: Object.assign(
    (selector: (value: typeof layout) => unknown) => selector(layout),
    { getState: () => layout },
  ),
}));
vi.mock('../SplitNode', () => ({
  SplitNodeView: () => (
    <>
      <textarea />
      <div role="dialog">
        <input />
      </div>
    </>
  ),
}));
vi.mock('../TabGroup', () => ({ TabGroup: () => null }));
import { Workbench } from '../Workbench';

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.platform = 'mac';
  state.closeTab.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<Workbench bindings={defaultKeybindings()} onNewChat={() => {}} />),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const press = (target: Element, modifiers: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', {
    key: 'w',
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  target.dispatchEvent(event);
  return event;
};

it('Mac 编辑器或终端聚焦时 ⌘W 关闭标签，Ctrl+W 仍交给输入区域', () => {
  const textarea = container.querySelector('textarea')!;
  expect(press(textarea, { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(state.closeTab).not.toHaveBeenCalled();
  expect(press(textarea, { metaKey: true }).defaultPrevented).toBe(true);
  expect(state.closeTab).toHaveBeenCalledWith('note', 'group');
});
it('弹窗内不关闭后方工作台标签', () => {
  expect(press(container.querySelector('input')!, { metaKey: true }).defaultPrevented).toBe(false);
  expect(state.closeTab).not.toHaveBeenCalled();
});
it('Windows 保留原有输入区域守卫与 Ctrl+W 行为', () => {
  state.platform = 'other';
  expect(press(container.querySelector('textarea')!, { ctrlKey: true }).defaultPrevented).toBe(
    false,
  );
  expect(state.closeTab).not.toHaveBeenCalled();
  expect(press(container.firstElementChild!, { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(state.closeTab).toHaveBeenCalledWith('note', 'group');
});
