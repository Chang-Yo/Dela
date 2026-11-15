import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { MigrationContext } from '../types';

interface V10Provider {
  baseUrl?: unknown;
  models?: unknown;
  modelConfigs?: Record<string, { effort?: unknown }>;
  presetId?: unknown;
  [key: string]: unknown;
}

// Pi 1.1.0 目录中的模型与思考档位；按 API 地址认出旧预设对应的内置厂商。
const vendors: {
  piProvider: string;
  urls: string[];
  baseUrl: string;
  models: Record<string, string[]>;
}[] = [
  {
    piProvider: 'deepseek',
    urls: ['https://api.deepseek.com', 'https://api.deepseek.com/v1'],
    baseUrl: 'https://api.deepseek.com',
    models: {
      'deepseek-flash': ['none', 'low', 'high', 'max'],
      'deepseek-v4-pro': ['none', 'high', 'max'],
    },
  },
  {
    piProvider: 'zai-coding-cn',
    urls: ['https://open.bigmodel.cn/api/coding/paas/v4'],
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    models: {
      'glm-4.6v': ['none', 'minimal', 'low', 'medium', 'high'],
      'glm-5.3': ['low', 'high', 'max'],
      'glm-5.3-flash': ['low', 'high', 'max'],
      'glm-5.3-highspeed': ['low', 'high', 'max'],
    },
  },
  {
    piProvider: 'minimax-cn',
    urls: ['https://api.minimaxi.com/v1', 'https://api.minimaxi.com/anthropic'],
    baseUrl: 'https://api.minimaxi.com/anthropic',
    models: {
      'MiniMax-M2.7': ['none', 'minimal', 'low', 'medium', 'high'],
      'MiniMax-M2.7-highspeed': ['none', 'minimal', 'low', 'medium', 'high'],
      'MiniMax-M3': ['none', 'minimal', 'low', 'medium', 'high'],
    },
  },
];

const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/** 沿用原来的默认档位；不在新档位里就取 medium 或比它高的最近一档。 */
function effortFor(levels: string[], previous: unknown): string | undefined {
  if (typeof previous === 'string' && levels.includes(previous)) return previous;
  const medium = effortOrder.indexOf('medium');
  return levels.find((level) => effortOrder.indexOf(level) >= medium) ?? levels.at(-1);
}

function convert(provider: V10Provider) {
  const { presetId: _presetId, ...rest } = provider;
  const custom = { ...rest, piProvider: null };
  const url = typeof provider.baseUrl === 'string' ? provider.baseUrl.replace(/\/+$/, '') : '';
  const vendor = vendors.find(({ urls }) => urls.includes(url));
  if (!vendor || !Array.isArray(provider.models)) return custom;
  const catalog = vendor.models;
  const models = provider.models.filter(
    (id): id is string => typeof id === 'string' && id in catalog,
  );
  if (models.length === 0) return custom;
  return {
    ...rest,
    baseUrl: vendor.baseUrl,
    models,
    modelConfigs: Object.fromEntries(
      models.map((id) => {
        const effortLevels = catalog[id]!;
        const effort = effortFor(effortLevels, provider.modelConfigs?.[id]?.effort);
        return [id, { effortLevels, ...(effort ? { effort } : {}) }];
      }),
    ),
    piProvider: vendor.piProvider,
  };
}

/**
 * Dela 自带的预设改由 Pi 内置厂商承担：presetId 换成 piProvider。
 * 指向 DeepSeek、智谱 Coding、MiniMax 的配置转为内置厂商，只保留目录里有的模型；
 * 一个都不剩的、以及其余配置，都作为自定义服务保留。
 */
export function v10tov11(_db: Database.Database, { userData, seal }: MigrationContext): void {
  const path = join(userData, 'llm-providers.bin');
  if (!existsSync(path)) return;
  let config: { providers?: V10Provider[] };
  try {
    config = JSON.parse(seal.decrypt(readFileSync(path)));
  } catch {
    return;
  }
  const providers = Array.isArray(config.providers) ? config.providers : [];
  if (providers.every((provider) => 'piProvider' in provider)) return;
  const next = { ...config, providers: providers.map(convert) };
  const temporary = `${path}.v11.tmp`;
  writeFileSync(temporary, seal.encrypt(JSON.stringify(next)));
  renameSync(temporary, path);
}
