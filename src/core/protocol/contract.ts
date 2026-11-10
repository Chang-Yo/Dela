// main 与 view 之间的契约：一处声明通道与入参 schema，主进程实现、渲染端调用都从它推导类型。
// 返回值由主进程生成，output 只承载类型，不做运行时校验。
import type { z } from 'zod';

type Procedures = Record<string, { input: z.ZodType; output: z.ZodType }>;

export interface Contract<P extends Procedures = Procedures> {
  namespace: string;
  procedures: P;
}

type Procedure<C extends Contract, K extends keyof C['procedures']> = C['procedures'][K];

export type Handlers<C extends Contract> = {
  [K in keyof C['procedures']]: (
    input: z.output<Procedure<C, K>['input']>,
  ) => z.output<Procedure<C, K>['output']> | Promise<z.output<Procedure<C, K>['output']>>;
};

export type Client<C extends Contract> = {
  [K in keyof C['procedures']]: (
    input: z.input<Procedure<C, K>['input']>,
  ) => Promise<z.output<Procedure<C, K>['output']>>;
};

/** 擦除了具体类型的实现，app 只需要通道名和一个统一的调用入口。 */
export interface Implementation {
  contract: Contract;
  call(name: string, input: unknown): unknown;
}

/** preload 暴露给渲染端的唯一入口，只放行已登记契约的通道。 */
export interface Bridge {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

export function defineContract<const P extends Procedures>(
  namespace: string,
  procedures: P,
): Contract<P> {
  return { namespace, procedures };
}

export function channelsOf(contract: Contract): string[] {
  return Object.keys(contract.procedures).map((name) => `${contract.namespace}:${name}`);
}

export function implement<C extends Contract>(contract: C, handlers: Handlers<C>): Implementation {
  return {
    contract,
    call(name, input) {
      const procedure = contract.procedures[name];
      if (!procedure) throw new Error(`未知的调用：${contract.namespace}:${name}`);
      const handler = handlers[name] as (input: unknown) => unknown;
      return handler(procedure.input.parse(input));
    },
  };
}

export function createClient<C extends Contract>(
  contract: C,
  bridge: Bridge | undefined,
): Client<C> {
  const call = async (name: string, input: unknown) => {
    if (!bridge) throw new Error('请在 Dela 桌面端使用');
    try {
      return await bridge.invoke(`${contract.namespace}:${name}`, input);
    } catch (error) {
      // Electron 会给主进程抛出的错误加上「Error invoking remote method」前缀
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''));
    }
  };
  return Object.fromEntries(
    Object.keys(contract.procedures).map((name) => [name, (input: unknown) => call(name, input)]),
  ) as Client<C>;
}
