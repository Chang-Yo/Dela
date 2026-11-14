import { expect, it } from 'vitest';
import { analyzeNoticePage, type NoticeEntry } from './parser';
import { subscriptionStateSchema, updateSubscription } from './state';

const rule = analyzeNoticePage(
  '<ul><li><a href="/one">第一条学院公告</a></li><li><a href="/two">第二条学院公告</a></li></ul>',
  'https://unknown.example/',
).candidates[0]!.rule;
const entry = (id: string, title = `学院公告 ${id}`): NoticeEntry => ({
  id,
  url: `https://unknown.example/${id}`,
  title,
  publishedAt: null,
});

it('establishes a quiet baseline and persists the rule and identities as JSON', () => {
  const initial = updateSubscription(rule, [entry('one'), entry('two')]);
  expect(initial.baseline).toBe(true);
  expect(initial.newEntries).toEqual([]);
  expect(subscriptionStateSchema.parse(JSON.parse(JSON.stringify(initial.state)))).toEqual(
    initial.state,
  );
});

it('notifies new identities once, including older-dated entries, and ignores ordering/title edits', () => {
  const initial = updateSubscription(rule, [entry('one'), entry('two')]);
  const entries = [entry('two', '修订后的公告标题'), entry('three'), entry('one'), entry('three')];
  const next = updateSubscription(rule, entries, initial.state);
  expect(next.newEntries.map((item) => item.id)).toEqual(['three']);
  expect(updateSubscription(rule, entries, next.state).newEntries).toEqual([]);
});

it('does not resurrect previously seen entries after they leave and reenter the visible list', () => {
  const initial = updateSubscription(rule, [entry('one'), entry('two')]);
  const next = updateSubscription(rule, [entry('two'), entry('three')], initial.state);
  expect(updateSubscription(rule, [entry('one'), entry('three')], next.state).newEntries).toEqual(
    [],
  );
});

it('rejects empty results or a changed subscription without changing the previous state', () => {
  const initial = updateSubscription(rule, [entry('one')]);
  const before = JSON.stringify(initial.state);
  expect(() => updateSubscription(rule, [], initial.state)).toThrow('保留');
  expect(() =>
    updateSubscription({ ...rule, label: '不同栏目' }, [entry('one')], initial.state),
  ).toThrow('规则已改变');
  expect(JSON.stringify(initial.state)).toBe(before);
});
