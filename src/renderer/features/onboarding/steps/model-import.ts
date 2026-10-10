import { LLM_MODEL_LIMIT } from '../../../../shared/llm-presets';

/** 勾选结果按检测列表顺序回传；列表外的勾选（换过服务商后的残留）自然被丢掉。 */
export function selectedModels(options: string[], checked: ReadonlySet<string>): string[] {
  return options.filter((id) => checked.has(id));
}

/** 写入配置前的上限收敛；提示文案与设置页同一套，避免两处说法不一致。 */
export function capModels(
  picked: string[],
  limit = LLM_MODEL_LIMIT,
): { models: string[]; notice: string } {
  if (picked.length <= limit) return { models: picked, notice: `已导入 ${picked.length} 个模型` };
  return {
    models: picked.slice(0, limit),
    notice: `模型数量过多，最多保留 ${limit} 个，${picked.length - limit} 个未导入`,
  };
}
