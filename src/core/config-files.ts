// ~/.dela 下的 JSON 配置：用户和 magpie 等工具可以直接编辑，所以 Dela 每次都读最新内容，只改自己要改的那一项。
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostPorts } from './ports';

export type ConfigFileName = 'config.json' | 'mcp.json';
export type JsonObject = Record<string, unknown>;

const configFileNames: ConfigFileName[] = ['config.json', 'mcp.json'];

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function configDirectory(): string {
  return join(hostPorts().paths.home(), '.dela');
}

export function configFilePath(name: ConfigFileName): string {
  return join(configDirectory(), name);
}

export class ConfigFileError extends Error {
  constructor(path: string, cause?: unknown) {
    super(`${path} 不是有效的 JSON，请修正后重试；修正前 Dela 不会改写这个文件`, { cause });
    this.name = 'ConfigFileError';
  }
}

/** 写坏的文件直接报错而不当作空配置：否则下一次保存会把用户的内容整个覆盖掉。 */
export function readConfigFile(name: ConfigFileName): JsonObject {
  const path = configFilePath(name);
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new ConfigFileError(path, cause);
  }
  if (!isJsonObject(parsed)) throw new ConfigFileError(path);
  return parsed;
}

/** 整份替换写入，外部工具不会读到写了一半的文件；Key 是明文，文件只给本人读写。 */
export function updateConfigFile(name: ConfigFileName, update: (config: JsonObject) => void): void {
  const config = readConfigFile(name);
  update(config);
  const path = configFilePath(name);
  mkdirSync(configDirectory(), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

/** 取出文件里的一个对象分区（如 providers），不存在或不是对象时新建。 */
export function sectionOf(config: JsonObject, key: string): JsonObject {
  const section = config[key];
  if (isJsonObject(section)) return section;
  const created: JsonObject = {};
  config[key] = created;
  return created;
}

/** 新条目的键用可读的短名字，重名时加 -2、-3；按分区里的全部键判重，写错被跳过的项也不会被顶掉。 */
export function uniqueKey(section: JsonObject, base: string): string {
  if (!(base in section)) return base;
  for (let suffix = 2; ; suffix++)
    if (!(`${base}-${suffix}` in section)) return `${base}-${suffix}`;
}

/** 文件是整份替换的，所以监听目录而不是文件；一次保存会触发好几个事件，合并成一次通知。 */
export function watchConfigFiles(onChange: (name: ConfigFileName) => void): () => void {
  const directory = configDirectory();
  mkdirSync(directory, { recursive: true });
  const timers = new Map<ConfigFileName, ReturnType<typeof setTimeout>>();
  const watcher = watch(directory, (_event, filename) => {
    const name = configFileNames.find((candidate) => candidate === filename);
    if (!name) return;
    clearTimeout(timers.get(name));
    timers.set(
      name,
      setTimeout(() => onChange(name), 200),
    );
  });
  // 目录被删时 watcher 会报错；不处理会让主进程崩溃，删掉的目录在下次保存时重建。
  watcher.on('error', () => watcher.close());
  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    watcher.close();
  };
}
