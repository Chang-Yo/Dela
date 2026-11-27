// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MailAccountForm } from './MailAccountForm';
import { registerMailPreset, type MailPreset } from './presets';

const preset: MailPreset = {
  label: '学校邮箱',
  domain: 'school.edu',
  server: {
    imapHost: 'mail.school.edu',
    imapPort: 993,
    smtpHost: 'mail.school.edu',
    smtpPort: 465,
  },
  passwordHint: '统一身份密码',
};
registerMailPreset(preset);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

it('connects a preset account with the preset servers only when the address is on its domain', async () => {
  const onSubmit = vi.fn();
  await act(async () =>
    root.render(<MailAccountForm error={null} onSubmit={onSubmit} submit={null} />),
  );
  await fill('input[type=email]', 'me@example.com');
  await fill('input[type=password]', 'pw');
  await submit();
  expect(onSubmit).not.toHaveBeenCalled();

  await fill('input[type=email]', ' Me@School.edu ');
  await submit();
  expect(onSubmit).toHaveBeenCalledWith({
    address: 'Me@School.edu',
    password: 'pw',
    server: preset.server,
  });
});
