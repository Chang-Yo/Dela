// 资源解析注册表：引用按 type 交给注册它的模块读取或落成文件，core 不认识具体来源。
export interface ResourceResolver<Ref extends { type: string } = { type: string }> {
  /** Agent 读取：正文按字符分页，读不了正文的返回读取指引。 */
  read(ref: Ref, offset: number, limit: number): Promise<unknown>;
  /** 资源在本机的持久文件，可交给系统默认应用打开。 */
  path?(ref: Ref): Promise<string>;
  /** 没有持久文件的资源临时落盘交给 consume，结束后清理。 */
  withFile?<T>(ref: Ref, consume: (path: string) => Promise<T> | T): Promise<T>;
}

const resolvers = new Map<string, ResourceResolver>();

export function registerResourceResolver<Ref extends { type: string }>(
  type: Ref['type'],
  resolver: ResourceResolver<Ref>,
): void {
  resolvers.set(type, resolver as ResourceResolver);
}

export function resourceResolver(type: string): ResourceResolver {
  const resolver = resolvers.get(type);
  if (!resolver) throw new Error(`无法读取 ${type} 类型的资源`);
  return resolver;
}
