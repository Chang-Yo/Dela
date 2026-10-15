/** 设置 › 通用 底部的缓存占用与清理（Chromium 的可再生缓存）。 */
export interface CacheApi {
  /** 当前占用的字节数；量的是磁盘上这些缓存目录的真实大小。 */
  getSize(): Promise<number>;
  /** 清掉能清的部分，返回实际释放的字节数与是否被正在运行的进程挡住。 */
  clear(): Promise<CacheClearResult>;
}

export interface CacheClearResult {
  /** 清除前后各量一次得到的差值。 */
  freed: number;
  /** 有文件被占住没能删掉：Chromium 继续用它们，重启应用后可再清一次。 */
  blocked: boolean;
}
