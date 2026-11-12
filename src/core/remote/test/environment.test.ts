// 受限环境诊断的分类规则：纯字符串进、文案出，离线可测。
// 诊断脚本（diagnoseEnvironment）要真远端才能跑，见 helper.test.ts 的真机套件。
import { describe, expect, it } from 'vitest';

import { classifyEnvironment } from '../helper';

const line = (pairs: Record<string, string>) =>
  Object.entries(pairs)
    .map(([key, value]) => `${key}=${value}`)
    .join('|');

describe('受限环境诊断分类', () => {
  it('noexec 挂载点：点名 noexec', () => {
    expect(
      classifyEnvironment(
        line({
          mount: 'rw,noexec,relatime',
          writable: 'yes',
          selinux: 'absent',
          direct: 'exit-126',
        }),
      ),
    ).toContain('noexec');
  });

  it('只读挂载：只读优先于执行被拒', () => {
    expect(
      classifyEnvironment(
        line({ mount: 'ro,relatime', writable: 'no', selinux: 'absent', direct: 'exit-126' }),
      ),
    ).toContain('只读');
  });

  it('目录不可写（挂载信息拿不到时兜底）', () => {
    expect(
      classifyEnvironment(
        line({ mount: '', writable: 'no', selinux: 'absent', direct: 'exit-126' }),
      ),
    ).toContain('不可写');
  });

  it('SELinux Enforcing 且直接执行失败：点名 SELinux', () => {
    expect(
      classifyEnvironment(
        line({ mount: 'rw', writable: 'yes', selinux: 'Enforcing', direct: 'exit-126' }),
      ),
    ).toContain('SELinux');
  });

  it('直接执行被拒但没有更具体的原因：给出通用解释', () => {
    expect(
      classifyEnvironment(
        line({ mount: 'rw', writable: 'yes', selinux: 'absent', direct: 'exit-126' }),
      ),
    ).toContain('被拒绝');
  });

  it('执行没被拦（--version 能跑）不硬编原因：返回 null 让原始错误说话', () => {
    expect(
      classifyEnvironment(
        line({ mount: 'rw', writable: 'yes', selinux: 'Enforcing', direct: 'ok' }),
      ),
    ).toBeNull();
    expect(classifyEnvironment('')).toBeNull();
  });
});
