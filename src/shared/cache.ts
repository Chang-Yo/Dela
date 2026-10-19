/** 设置 › 通用 底部的缓存占用与清理（Chromium 的可再生缓存）。 */
export interface CacheApi {
  /** 量的是磁盘上缓存目录的真实大小。 */
  getSize(): Promise<number>;
  clear(): Promise<CacheClearResult>;
}

export interface CacheClearResult {
  freed: number;
  /** 有文件被占住没能删掉：Chromium 继续用它们，重启应用后可再清一次。 */
  blocked: boolean;
}
