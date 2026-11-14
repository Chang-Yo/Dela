import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries, type NoticeRule } from './parser';

const pageUrl = 'https://unknown-school.example/';
const authenticationPage =
  '<h1>Happening now.</h1><div id="choices">' +
  '<a href="/account?mode=signup"><span>Continue with phone</span></a>' +
  '<a href="/account?mode=login"><span>Continue with Apple</span></a></div>';

it('rejects repeated authentication choices without a site-specific rule', () => {
  const result = analyzeNoticePage(authenticationPage, pageUrl);
  expect(result.status).toBe('unsupported');
  expect(result.candidates).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

it.each([
  'Sign in',
  'Sign up',
  'Log in',
  'Login',
  'Register',
  'Create an account',
  'Sign in with Google',
  'Forgot your password?',
  'Reset password',
  '统一身份认证登录',
  '用户登录',
  '立即注册',
  '找回密码',
])('does not accept the authentication control %s through a title sample', (title) => {
  const html = `<div><a href="/account">${title}</a></div>`;
  expect(analyzeNoticePage(html, pageUrl, { sampleTitle: title }).candidates).toEqual([]);
});

it('excludes authentication actions implemented as literal onclick jumps', () => {
  const html =
    '<div><div onclick="location.href=\'/account?mode=login\'">Continue with Google</div>' +
    '<div onclick="window.open(\'/account?mode=signup\')">Create account</div></div>';
  expect(analyzeNoticePage(html, pageUrl).candidates).toEqual([]);
});

it('rejects replay of a previously saved authentication rule', () => {
  const rule: NoticeRule = {
    version: 1,
    kind: 'html',
    pageUrl,
    label: 'Happening now.',
    containerSelector: '#choices',
    itemSelector: 'a',
    linkSelector: null,
    expectsDates: false,
  };
  expect(() => extractNoticeEntries(authenticationPage, rule)).toThrow(/失配|重新确认/);
});

it('keeps undated notices about authentication alongside real account controls', () => {
  const html =
    authenticationPage +
    '<section><h2>通知公告</h2><ul>' +
    '<li><a href="/news/login-update">关于统一身份认证登录流程的通知</a><a href="/account?mode=login">Sign in</a></li>' +
    '<li><a href="/news/registration">Registration</a><a href="/account?mode=signup">Create account</a></li>' +
    '</ul></section>';
  const result = analyzeNoticePage(html, pageUrl);
  expect(result.candidates).toHaveLength(1);
  const candidate = result.candidates[0]!;
  expect(candidate.entries.map(({ title, publishedAt }) => [title, publishedAt])).toEqual([
    ['关于统一身份认证登录流程的通知', null],
    ['Registration', null],
  ]);
  expect(extractNoticeEntries(html, candidate.rule)).toEqual(candidate.entries);
  const single = html.replace(/<li><a href="\/news\/registration">.*?<\/li>/, '');
  expect(
    analyzeNoticePage(single, pageUrl, { sampleTitle: '关于统一身份认证登录流程的通知' })
      .candidates[0]?.entries,
  ).toEqual([candidate.entries[0]]);
});

it('does not save an authentication baseline and preserves an existing state on failed refresh', async () => {
  const directory = await mkdtemp(resolve('.tools/notice-subscriptions/auth-test-'));
  const htmlPath = join(directory, 'page.html');
  const statePath = join(directory, 'state.json');
  const call = (...args: string[]) =>
    spawnSync(process.execPath, [resolve('.tools/notice-subscriptions/cli.cjs'), ...args], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
  try {
    await writeFile(htmlPath, authenticationPage);
    const rejected = call(
      'preview',
      pageUrl,
      '--file',
      htmlPath,
      '--select',
      '1',
      '--save',
      statePath,
    );
    expect(rejected.status).toBe(1);
    await expect(readFile(statePath)).rejects.toThrow();
    const notices =
      '<h1>Happening now.</h1><div id="choices">' +
      '<a href="/news/1">First school announcement</a>' +
      '<a href="/news/2">Second school announcement</a></div>';
    await writeFile(htmlPath, notices);
    const saved = call(
      'preview',
      pageUrl,
      '--file',
      htmlPath,
      '--select',
      '1',
      '--save',
      statePath,
    );
    expect(saved.status, saved.stderr).toBe(0);
    const previous = await readFile(statePath, 'utf8');
    await writeFile(htmlPath, authenticationPage);
    const refreshed = call('refresh', statePath, '--file', htmlPath);
    expect(refreshed.status).toBe(1);
    expect(refreshed.stderr).toMatch(/失配|重新确认/);
    expect(await readFile(statePath, 'utf8')).toBe(previous);
  } finally {
    for (const path of [htmlPath, statePath]) await unlink(path).catch(() => {});
    await rmdir(directory);
  }
});
