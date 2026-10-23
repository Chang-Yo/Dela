// 会话命令的识别：命令名后要么结束、要么空白再跟参数；参数可以跨行（/compact 的压缩说明）。
import { expect, it } from 'vitest';
import { parseSessionCommand } from './session';

it('recognizes session commands and keeps multiline arguments', () => {
  expect(parseSessionCommand('/compact')).toEqual({ name: 'compact', args: '' });
  expect(parseSessionCommand('  /compact 保留结论\n以及待办  ')).toEqual({
    name: 'compact',
    args: '保留结论\n以及待办',
  });
  expect(parseSessionCommand('/name\t课程周报')).toEqual({ name: 'name', args: '课程周报' });
  expect(parseSessionCommand('/compactor')).toBeNull();
  expect(parseSessionCommand('/Compact')).toBeNull();
  expect(parseSessionCommand('请 /compact')).toBeNull();
  expect(parseSessionCommand('/skill:review')).toBeNull();
});
