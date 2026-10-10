// 向导导入模型的纯逻辑：勾选结果按检测列表顺序回传，超出上限的勾选不写入配置。
import { describe, expect, it } from 'vitest';
import { capModels, selectedModels } from './model-import';

describe('模型导入选择', () => {
  it('按检测列表顺序回传勾选结果，列表外的勾选被丢掉', () => {
    expect(selectedModels(['a', 'b', 'c'], new Set(['c', 'a', '换过服务商残留']))).toEqual([
      'a',
      'c',
    ]);
  });

  it('超出上限的勾选不写入，并说明少了几个', () => {
    expect(capModels(['a', 'b', 'c', 'd', 'e'], 3)).toEqual({
      models: ['a', 'b', 'c'],
      notice: '模型数量过多，最多保留 3 个，2 个未导入',
    });
  });

  it('未超出上限时全部写入并报出数量', () => {
    expect(capModels(['a', 'b'], 3)).toEqual({ models: ['a', 'b'], notice: '已导入 2 个模型' });
  });
});
