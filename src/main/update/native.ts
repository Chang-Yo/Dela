// 商店更新原生模块的加载与类型包装。
//
// 加载失败不能让主进程倒掉：模块会因为没跑 `pnpm build:native`、或打包时漏收而缺失，
// 这里一律降级成 null，由 index.ts 转成 unsupported 状态。
//
// 用 process.dlopen 而不是 require：路径是运行时拼出来的，不该让打包器去解析它；
// Electron 会在这里接住 asar 内的 .node 并重定向到 app.asar.unpacked。
import { join } from 'node:path';

export interface StorePackageUpdate {
  /** 四段包版本，如 1.0.1.0。 */
  version: string;
  mandatory: boolean;
  familyName: string;
}

/** 原生侧的失败：不跨边界抛异常，用普通对象表达。 */
export interface NativeFailure {
  ok: false;
  code: number;
  state: string;
  message: string;
}

export type NativeCheckResult = { ok: true; updates: StorePackageUpdate[] } | NativeFailure;
export type NativeOperationResult = { ok: true } | NativeFailure;

export interface StoreUpdateAddon {
  check(handle: Buffer): Promise<NativeCheckResult>;
  download(handle: Buffer, onProgress: (progress: number) => void): Promise<NativeOperationResult>;
  install(handle: Buffer): Promise<NativeOperationResult>;
}

let cached: StoreUpdateAddon | null | undefined;

/** out/main/index.cjs 的上一级就是 out/，原生模块固定在 out/native。 */
function addonPath(): string {
  return join(__dirname, '..', 'native', 'store_update.node');
}

export function loadStoreUpdate(): StoreUpdateAddon | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const holder = { exports: {} } as unknown as NodeModule;
    process.dlopen(holder, addonPath());
    const addon = holder.exports as StoreUpdateAddon;
    if (
      typeof addon.check !== 'function' ||
      typeof addon.download !== 'function' ||
      typeof addon.install !== 'function'
    ) {
      throw new Error('原生模块导出与预期不符');
    }
    cached = addon;
  } catch (error) {
    console.error('Store update module unavailable', error);
  }
  return cached;
}
