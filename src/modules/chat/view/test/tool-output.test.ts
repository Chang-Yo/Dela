import { expect, it } from 'vitest';
import { editLineCounts, parseReadOutput } from '../tool-output';

it('edit 只统计真正变动的行，首尾相同的行不计', () => {
  expect(editLineCounts([{ oldText: 'a\nb\nc\nd\ne', newText: 'a\nb\nX\nd\ne' }])).toEqual({
    added: 1,
    deleted: 1,
  });
  expect(editLineCounts([{ oldText: '', newText: 'x\ny' }])).toEqual({ added: 2, deleted: 0 });
  expect(editLineCounts([{ oldText: 'x\ny', newText: 'x' }])).toEqual({ added: 0, deleted: 1 });
});

it('read 拆出 Pi 追加在尾部的截断提示，并还原行范围', () => {
  const truncated = parseReadOutput('a\nb\n\n[Showing lines 1-2 of 90. Use offset=3 to continue.]');
  expect(truncated.body).toBe('a\nb');
  expect(truncated.range).toEqual({ from: 1, to: 2, total: 90 });
  const limited = parseReadOutput('a\nb\n\n[8 more lines in file. Use offset=13 to continue.]', 11);
  expect(limited.range).toEqual({ from: 11, to: 12, total: 20 });
  expect(parseReadOutput('a\nb').range).toBeUndefined();
});
