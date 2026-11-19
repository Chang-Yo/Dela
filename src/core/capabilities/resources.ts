// 资源解析注册表：引用按 type 交给注册它的模块读取或落成文件，core 不认识具体来源。
export interface ResourceResolver<Ref extends { type: string } = { type: string }> {
  read(ref: Ref, offset: number, limit: number): Promise<unknown>;
  path?(ref: Ref): Promise<string>;
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
  if (!resolver) throw new Error(`无法读取 ${type} 类型的资源：对应的功能在当前版本中未启用`);
  return resolver;
}
