// 资源地址注册表：每种地址由登记它的模块给出格式、说明与读取方式，core 不认识具体来源。
import { z } from 'zod';
import type { ResourceAddress } from '../protocol/workbench';

export interface ResourceResolver<Address extends ResourceAddress = ResourceAddress> {
  schema: z.ZodType<Address>;
  /** 给 Agent 的一行说明：地址的写法，以及读到的是什么。 */
  description: string;
  read(address: Address, offset: number, limit: number): Promise<unknown>;
  path?(address: Address): Promise<string>;
  withFile?<T>(address: Address, consume: (path: string) => Promise<T> | T): Promise<T>;
}

const resolvers = new Map<string, ResourceResolver>();

export function registerResourceResolver<Address extends ResourceAddress>(
  type: Address['type'],
  resolver: ResourceResolver<Address>,
): void {
  resolvers.set(type, resolver as unknown as ResourceResolver);
}

export function resourceResolver(type: string): ResourceResolver {
  const resolver = resolvers.get(type);
  if (!resolver) throw new Error(`无法读取 ${type} 类型的资源：对应的功能在当前版本中未启用`);
  return resolver;
}

export async function withResourceFile<T>(
  source: ResourceAddress,
  consume: (path: string) => Promise<T> | T,
): Promise<T> {
  const resolver = resourceResolver(source.type);
  if (resolver.path) return consume(await resolver.path(source));
  if (!resolver.withFile) throw new Error('该资源没有对应的文件');
  return resolver.withFile(source, consume);
}

/** 已登记的地址写法，拼进读取命令的说明。 */
export function resourceAddressGuide(): string {
  return [...resolvers].map(([type, resolver]) => `- ${type}：${resolver.description}`).join('\n');
}

/** 先按 type 找到登记者，再交给它的格式校验；未登记的种类直接拒绝。 */
export const resourceAddressSchema = z
  .looseObject({ type: z.string().min(1).max(64) })
  .transform((value, ctx): ResourceAddress => {
    const resolver = resolvers.get(value.type);
    if (!resolver) {
      ctx.addIssue({ code: 'custom', message: `无法识别 ${value.type} 类型的资源地址` });
      return z.NEVER;
    }
    const parsed = resolver.schema.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: z.prettifyError(parsed.error) });
      return z.NEVER;
    }
    return parsed.data;
  })
  .meta({ description: '资源地址，type 决定其余字段；可用的写法见 dela help read_resource' });
