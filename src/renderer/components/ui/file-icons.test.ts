// 图标映射表来自上游 manifest，会随依赖升级变化，这里只锁定匹配语义（查表顺序、
// 大小写归一、回落 null），不断言具体图标款式。
import { expect, it } from 'vitest';
import { fileIconUrl } from './file-icons';

it('完整文件名优先于扩展名后缀', () => {
  // package.json 应命中 nodejs 图标，而不是落到 json 扩展名的图标。
  expect(fileIconUrl('package.json')).toMatch(/nodejs\.svg$/);
});

it('后缀从长到短匹配', () => {
  // 「foo.spec.ts」应命中更长的 spec.ts 后缀；中间后缀不存在时落到 ts。
  expect(fileIconUrl('foo.spec.ts')).toMatch(/test-ts\.svg$/);
  expect(fileIconUrl('foo.zz.ts')).toMatch(/typescript\.svg$/);
});

it('文件名与扩展名匹配大小写不敏感', () => {
  expect(fileIconUrl('Dockerfile')).toMatch(/docker\.svg$/);
  expect(fileIconUrl('N.MD')).toMatch(/markdown\.svg$/);
});

it('点文件按完整文件名命中', () => {
  expect(fileIconUrl('.gitignore')).toMatch(/git\.svg$/);
});

it('未收录的文件返回 null，由调用方回落通用图标', () => {
  expect(fileIconUrl('c.xyz')).toBeNull();
});
