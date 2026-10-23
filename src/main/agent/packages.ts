// Pi packages：Dela 只持有「装了哪些、启没启用、开哪几类资源」，解析、安装与加载全部交给 Pi 的
// DefaultPackageManager / DefaultResourceLoader。状态存在 workspace_settings，建会话时把启用的包
// 写进 Pi 的内存设置（settings.packages），不读写 Pi 的 settings.json，与用户自己的 ~/.pi 互不影响。
// 只做全局范围：会话设置在内存里，项目 .pi/settings.json 里声明的包不会被读取。
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type { PackageSource } from '@earendil-works/pi-coding-agent';
import type {
  NpmRegistry,
  PackageProgress,
  PackageResourceCounts,
  PackageResourceToggles,
  PackageProvides,
  PackageSettings,
  PackageSourceType,
  PiPackageView,
} from '../../shared/packages';
import { inventoryPackages } from './discovery';
import { readSetting, writeSetting } from '../settings/prefs';
import { loadPi, piAgentDir } from './pi';
import {
  ensureNpmRuntime,
  locateNpm,
  npmRuntimeState,
  resetNpmRuntimeState,
  restoreNpmRuntime,
  type NpmRuntime,
} from './npm-runtime';

const ENABLED_KEY = 'pi-packages-enabled';
const REGISTRY_KEY = 'pi-packages-registry';
const PACKAGES_KEY = 'pi-packages';
const PROMPTS_DISABLED_KEY = 'prompts-disabled';

const REGISTRIES: Record<NpmRegistry, string> = {
  npmjs: 'https://registry.npmjs.org/',
  npmmirror: 'https://registry.npmmirror.com/',
};

const storedSchema = z.object({
  id: z.string().uuid(),
  source: z.string().min(1).max(4096),
  enabled: z.boolean(),
  resources: z.object({ extensions: z.boolean(), skills: z.boolean(), prompts: z.boolean() }),
  installedAt: z.string(),
  /** 装好时 Pi 给的安装目录；建会话前据此确认包还在。 */
  installedPath: z.string().optional(),
});
type StoredPackage = z.infer<typeof storedSchema>;

function readPackages(): StoredPackage[] {
  try {
    return z.array(storedSchema).parse(JSON.parse(readSetting(PACKAGES_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function writePackages(packages: StoredPackage[]) {
  writeSetting(PACKAGES_KEY, JSON.stringify(packages));
}

/** 按名称停用的 prompt 模板：会话经 promptsOverride 过滤，与 Skills 的全局名单同一种做法。 */
export function readDisabledPrompts(): Set<string> {
  try {
    return new Set(
      z.array(z.string()).parse(JSON.parse(readSetting(PROMPTS_DISABLED_KEY) ?? '[]')),
    );
  } catch {
    return new Set();
  }
}

export function setPromptEnabled(name: string, enabled: boolean): Promise<PiPackageView[]> {
  const disabled = readDisabledPrompts();
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  writeSetting(PROMPTS_DISABLED_KEY, JSON.stringify([...disabled]));
  return listPackages();
}

/** 本地来源的安装目录就是它自己；npm/git 来源用装好时记下的目录。 */
function installedPathOf(item: StoredPackage): string | null {
  if (item.installedPath) return item.installedPath;
  return sourceType(item.source) === 'local' ? item.source : null;
}

export function packagesEnabled(): boolean {
  return readSetting(ENABLED_KEY) === '1';
}

function registry(): NpmRegistry {
  return readSetting(REGISTRY_KEY) === 'npmmirror' ? 'npmmirror' : 'npmjs';
}

export function packageSettings(): PackageSettings {
  return { enabled: packagesEnabled(), runtime: npmRuntimeState(), registry: registry() };
}

/**
 * 来源串规范化成 Pi 认得的形态：本地路径一律转绝对路径（Pi 会按设置文件所在目录解析相对路径，
 * 而 Dela 的设置在内存里，没有那个目录）；`npm:`、`git:` 与 URL 原样交给 Pi 解析。
 */
export function normalizeSource(raw: string): { source: string; type: PackageSourceType } {
  const source = raw.trim();
  if (!source) throw new Error('请输入包的来源');
  if (source.startsWith('npm:') && !source.slice(4).trim()) throw new Error('npm 来源缺少包名');
  const type = sourceType(source);
  if (type !== 'local') return { source, type };
  const path = resolve(source.replace(/^~(?=[\\/]|$)/, homedir()));
  if (!isAbsolute(path) || !existsSync(path)) throw new Error(`本地路径不存在：${source}`);
  return { source: path, type: 'local' };
}

/** 只看写法、不碰磁盘：已登记的本地包目录可能已被删除，列清单时不能因此报错。 */
function sourceType(source: string): PackageSourceType {
  if (source.startsWith('npm:')) return 'npm';
  if (/^(git:|git@|ssh:\/\/|https?:\/\/)/.test(source)) return 'git';
  return 'local';
}

/**
 * 启用的包 → Pi settings.packages；关掉的资源类型写成 `[]`（Pi 的过滤语义：这一类都不加载）。
 * 安装目录不在了的包跳过：Pi 的加载器遇到缺失的 npm/git 来源会当场重装，没有 npm 时会让
 * 整个会话打不开。设置页对这种包给出「请重新安装」的诊断。
 */
export function enabledPackageSources(): PackageSource[] {
  if (!packagesEnabled()) return [];
  return readPackages()
    .filter((item) => {
      const path = installedPathOf(item);
      return item.enabled && path !== null && existsSync(path);
    })
    .map((item) => {
      const off = (['extensions', 'skills', 'prompts'] as const).filter(
        (kind) => !item.resources[kind],
      );
      // 主题是终端配色，Dela 的界面用不上，始终不加载。
      return {
        source: item.source,
        themes: [],
        ...Object.fromEntries(off.map((kind) => [kind, []])),
      };
    });
}

/** Pi 包管理与会话设置共用的 npm 配置；没有 npm 时只能装本地来源。 */
let runtime: NpmRuntime | null = null;

export function packageNpmCommand(): string[] | undefined {
  return runtime?.command;
}

async function manager(packages: PackageSource[]) {
  const pi = await loadPi();
  const settingsManager = pi.SettingsManager.inMemory({
    packages,
    ...(runtime ? { npmCommand: runtime.command } : {}),
  });
  return new pi.DefaultPackageManager({
    cwd: piAgentDir(),
    agentDir: piAgentDir(),
    settingsManager,
  });
}

/** npm 读 npm_config_registry；Pi 以 process.env 启动 npm，所以安装期间临时设置。 */
async function withRegistry<T>(task: () => Promise<T>): Promise<T> {
  const previous = process.env.npm_config_registry;
  process.env.npm_config_registry = REGISTRIES[registry()];
  try {
    return await task();
  } finally {
    if (previous === undefined) delete process.env.npm_config_registry;
    else process.env.npm_config_registry = previous;
  }
}

let progressListener: ((progress: PackageProgress) => void) | null = null;
export function onPackageProgress(listener: (progress: PackageProgress) => void) {
  progressListener = listener;
}

/** 同一时间只做一件安装类操作：Pi 的 npm 安装共用一个目录，并发写会互相覆盖。 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

async function piOperation(
  packages: PackageSource[],
  task: (pm: Awaited<ReturnType<typeof manager>>) => Promise<void>,
) {
  const pm = await manager(packages);
  pm.setProgressCallback((event) => {
    if (event.message) progressListener?.({ source: event.source, message: event.message });
  });
  await withRegistry(() => task(pm));
}

function requireRuntime(type: PackageSourceType) {
  if (type === 'local') return;
  if (type === 'npm' && !runtime) throw new Error('npm 不可用：请先在设置中开启 Pi packages');
}

export async function installPackage(raw: string): Promise<PiPackageView[]> {
  if (!packagesEnabled()) throw new Error('请先开启 Pi packages');
  const { source, type } = normalizeSource(raw);
  requireRuntime(type);
  return serial(async () => {
    const packages = readPackages();
    const identity = await packageIdentity();
    if (packages.some((item) => identity(item.source) === identity(source)))
      throw new Error('这个包已经安装过了');
    let installedPath: string | undefined;
    await piOperation([source], async (operation) => {
      await operation.install(source);
      installedPath = operation.getInstalledPath(source, 'user');
    });
    packages.push({
      installedPath,
      id: randomUUID(),
      source,
      enabled: false,
      resources: { extensions: true, skills: true, prompts: true },
      installedAt: new Date().toISOString(),
    });
    writePackages(packages);
    return listPackages();
  });
}

/**
 * 同一个包换个写法（版本号、.git 后缀、ssh 与 https）Pi 认作同一身份。这条规则只在 Pi 的
 * 私有方法 getPackageIdentity 里，git URL 的解析也不导出；方法不在了就退回按来源串比较。
 */
async function packageIdentity(): Promise<(source: string) => string> {
  const pm = (await manager([])) as unknown as { getPackageIdentity?(source: string): string };
  return (source) => pm.getPackageIdentity?.(source) ?? source;
}

function find(id: string): StoredPackage {
  const found = readPackages().find((item) => item.id === id);
  if (!found) throw new Error('包不存在');
  return found;
}

function patch(id: string, change: (item: StoredPackage) => void) {
  const packages = readPackages();
  const item = packages.find((entry) => entry.id === id);
  if (!item) throw new Error('包不存在');
  change(item);
  writePackages(packages);
}

export function setPackageEnabled(id: string, enabled: boolean): Promise<PiPackageView[]> {
  patch(id, (item) => {
    item.enabled = enabled;
  });
  return listPackages();
}

export function setPackageResources(
  id: string,
  resources: PackageResourceToggles,
): Promise<PiPackageView[]> {
  patch(id, (item) => {
    item.resources = resources;
  });
  return listPackages();
}

export function updatePackage(id: string): Promise<PiPackageView[]> {
  const item = find(id);
  requireRuntime(sourceType(item.source));
  return serial(async () => {
    await piOperation([item.source], (pm) => pm.update(item.source));
    inventoryEpoch++;
    return listPackages();
  });
}

/** 卸载：先删记录（调用方随即让会话失效），再删安装目录；本地来源只取消登记，不动用户的目录。 */
export function removePackage(id: string): Promise<PiPackageView[]> {
  const item = find(id);
  writePackages(readPackages().filter((entry) => entry.id !== id));
  return serial(async () => {
    if (sourceType(item.source) !== 'local')
      await piOperation([item.source], (pm) => pm.remove(item.source));
    return listPackages();
  });
}

export async function packageInstalledPath(id: string): Promise<string | null> {
  const item = find(id);
  const pm = await manager([item.source]);
  return pm.getInstalledPath(item.source, 'user') ?? null;
}

function manifest(path: string | null): { name?: string; version?: string; description?: string } {
  if (!path) return {};
  const file = statSync(path).isDirectory() ? join(path, 'package.json') : null;
  if (!file || !existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function displayName(source: string, type: PackageSourceType): string {
  if (type === 'npm') return source.slice(4).replace(/(?<=.)@[^@/]*$/, '');
  if (type === 'local') return basename(source);
  return source
    .replace(/^git:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/@[^@/]*$/, '');
}

/**
 * 列出已装的包与各自的资源数：资源数来自 Pi 的解析（与会话真正加载的是同一份），
 * 诊断来自最近一次会话加载时的扩展报错（loadDiagnostics）。
 */
export async function listPackages(): Promise<PiPackageView[]> {
  const packages = readPackages();
  if (!packages.length) return [];
  const pm = await manager(packages.map((item) => ({ source: item.source })));
  // 只看已装好的：缺失的 npm/git 来源不要在列清单时触发安装。
  const resolved = await pm.resolve(async () => 'skip');
  // 早先登记时没记下安装目录的包：按 Pi 的解析补上，会话加载与清单都靠它确认包还在。
  let backfilled = false;
  for (const item of packages) {
    const path = item.installedPath ?? pm.getInstalledPath(item.source, 'user');
    if (!item.installedPath && path && sourceType(item.source) !== 'local') {
      item.installedPath = path;
      backfilled = true;
    }
  }
  if (backfilled) writePackages(packages);
  const inventory = await packageInventory(packages).catch((error: unknown) => ({
    provides: new Map<string, PackageProvides>(),
    errors: new Map([['*', [error instanceof Error ? error.message : String(error)]]]),
  }));
  const disabledPrompts = [...readDisabledPrompts()];
  return packages.map((item) => {
    const type = sourceType(item.source);
    const installedPath = pm.getInstalledPath(item.source, 'user') ?? null;
    const owned = (kind: keyof typeof resolved) =>
      resolved[kind].filter((entry) => entry.metadata.source === item.source).length;
    const counts: PackageResourceCounts = {
      extensions: owned('extensions'),
      skills: owned('skills'),
      prompts: owned('prompts'),
      themes: owned('themes'),
    };
    const info = manifest(installedPath);
    return {
      id: item.id,
      source: item.source,
      type,
      name: info.name ?? displayName(item.source, type),
      version: info.version ?? null,
      description: info.description ?? null,
      installedPath,
      enabled: item.enabled,
      resources: item.resources,
      counts,
      provides: inventory.provides.get(item.source) ?? {
        skills: [],
        prompts: [],
        commands: [],
        tools: [],
        mcpServers: [],
        extensionsInspected: false,
      },
      disabledPrompts,
      installedAt: item.installedAt,
      diagnostics: [
        ...new Set([
          ...(installedPath ? [] : ['尚未安装或安装目录已被删除，请重新安装']),
          ...(inventory.errors.get(item.source) ?? []),
          ...(inventory.errors.get('*') ?? []),
          ...(loadDiagnostics.get(item.source) ?? []),
        ]),
      ],
    };
  });
}

/** 会话加载扩展时的报错，按包来源归档：设置页据此提示「这个包在 Dela 里没加载起来」。 */
const loadDiagnostics = new Map<string, string[]>();

export function recordLoadDiagnostics(entries: { source: string; message: string }[]) {
  const next = new Map<string, string[]>();
  for (const { source, message } of entries)
    next.set(source, [...(next.get(source) ?? []), message]);
  loadDiagnostics.clear();
  for (const [source, messages] of next) loadDiagnostics.set(source, [...new Set(messages)]);
}

export function setRegistry(value: NpmRegistry): PackageSettings {
  writeSetting(REGISTRY_KEY, value);
  return packageSettings();
}

/** 开启：先确定 npm（本机有就用，没有就下载），成功后才把开关写成开启。 */
export async function enablePackages(onChange: () => void): Promise<PackageSettings> {
  runtime = await ensureNpmRuntime(() => onChange());
  writeSetting(ENABLED_KEY, '1');
  return packageSettings();
}

export function disablePackages(): PackageSettings {
  writeSetting(ENABLED_KEY, '0');
  runtime = null;
  resetNpmRuntimeState();
  return packageSettings();
}

/** 启动时：开关已开就重新定位 npm（不下载）；定位不到时本地包照常可用。 */
export async function restorePackages(): Promise<void> {
  if (!packagesEnabled()) return;
  runtime = await restoreNpmRuntime();
}

export { locateNpm };

/**
 * 包清单（每个包提供的 skills、模板、命令、工具与 MCP 服务器）的缓存：清单要加载扩展代码，
 * 按包的登记状态与总开关做键，任何启停、按类开关都会换键；更新包内容不改登记，靠 epoch 失效。
 */
let inventoryEpoch = 0;
let inventoryCache: { key: string; value: ReturnType<typeof inventoryPackages> } | null = null;

function packageInventory(packages: StoredPackage[]) {
  const key = JSON.stringify([inventoryEpoch, packagesEnabled(), packages]);
  if (inventoryCache?.key !== key) {
    const load = new Map(
      enabledPackageSources().map((item) => [typeof item === 'string' ? item : item.source, item]),
    );
    const installed = packages.flatMap((item) => {
      const installedPath = installedPathOf(item);
      if (!installedPath || !existsSync(installedPath)) return [];
      return [
        {
          source: item.source,
          installedPath,
          load: item.resources.extensions ? (load.get(item.source) ?? null) : null,
        },
      ];
    });
    const value = inventoryPackages(installed);
    inventoryCache = { key, value };
    // 失败不缓存：下次打开设置页重新试。
    value.catch(() => {
      if (inventoryCache?.key === key) inventoryCache = null;
    });
  }
  return inventoryCache.value;
}
