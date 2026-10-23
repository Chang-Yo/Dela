// @vitest-environment jsdom
// 扩展界面请求的应用层宿主：对话框按到达顺序逐个弹出并把回答交回主进程，关掉等于取消；
// 主进程撤回（超时）的请求随即消失；通知走 toast；写输入框改的是对应会话的草稿。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, ExtensionUiEvent, ExtensionUiRequest } from '../../../shared/api';
import { useToastStore } from '../../app/toasts';
import { useChatDrafts } from './drafts';
import { ExtensionUiHost } from './ExtensionUiHost';

let container: HTMLDivElement;
let root: Root;
let pushRequest: (request: ExtensionUiRequest) => void;
let pushDismiss: (id: string) => void;
let pushEvent: (event: ExtensionUiEvent) => void;
const reply = vi.fn(async () => {});

function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  reply.mockClear();
  useToastStore.setState({ toasts: [] });
  useChatDrafts.setState({ drafts: {} });
  window.dela = {
    packages: {
      onUiRequest: (listener: typeof pushRequest) => ((pushRequest = listener), () => {}),
      onUiDismiss: (listener: typeof pushDismiss) => ((pushDismiss = listener), () => {}),
      onUiEvent: (listener: typeof pushEvent) => ((pushEvent = listener), () => {}),
      reply,
    },
  } as unknown as DelaApi;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ExtensionUiHost />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

it('shows dialogs one at a time in arrival order and returns each answer', async () => {
  await act(async () => {
    pushRequest({
      id: 'a',
      sessionId: 's',
      kind: 'select',
      title: 'Pick',
      options: ['red', 'blue'],
    });
    pushRequest({ id: 'b', sessionId: 's', kind: 'confirm', title: 'Sure?', message: 'really' });
  });
  expect(document.body.textContent).toContain('Pick');
  expect(document.body.textContent).not.toContain('Sure?');

  await act(async () => button('blue').click());
  expect(reply).toHaveBeenLastCalledWith('a', 'blue');
  expect(document.body.textContent).toContain('really');

  await act(async () => button('确定').click());
  expect(reply).toHaveBeenLastCalledWith('b', true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('treats closing an input dialog as cancel', async () => {
  await act(async () => pushRequest({ id: 'c', sessionId: 's', kind: 'input', title: 'Name' }));
  await act(async () => button('取消').click());
  expect(reply).toHaveBeenLastCalledWith('c', null);
});

it('drops a dialog the main process withdrew (timeout)', async () => {
  await act(async () =>
    pushRequest({
      id: 'd',
      sessionId: 's',
      kind: 'select',
      title: 'Late',
      options: ['x'],
      timeoutMs: 5000,
    }),
  );
  expect(document.body.textContent).toContain('5 秒内未回应将自动取消');
  await act(async () => pushDismiss('d'));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(reply).not.toHaveBeenCalled();
});

it('routes notifications to toasts and editor text to the session draft', async () => {
  await act(async () => {
    pushEvent({ type: 'notify', sessionId: 's', message: 'hello', level: 'info' });
    pushEvent({ type: 'error', sessionId: 's', extension: '/deploy', message: 'boom' });
  });
  expect(
    useToastStore.getState().toasts.map((toast) => [toast.variant, toast.description]),
  ).toEqual([
    ['neutral', 'hello'],
    ['error', 'boom'],
  ]);

  await act(async () => {
    pushEvent({ type: 'editor-text', sessionId: 's', text: 'draft', mode: 'replace' });
    pushEvent({ type: 'editor-text', sessionId: 's', text: ' more', mode: 'paste' });
  });
  expect(useChatDrafts.getState().drafts.s?.prompt).toBe('draft more');
});
