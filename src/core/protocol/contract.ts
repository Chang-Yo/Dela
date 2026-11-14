// main 与 view 之间的契约：一处声明通道与入参 schema，主进程实现、渲染端调用都从它推导类型。
// 返回值与推送事件由主进程生成，output 与 events 只承载类型，不做运行时校验。
import type { z } from 'zod';

type Procedures = Record<string, { input: z.ZodType; output: z.ZodType }>;
type Events = Record<string, z.ZodType>;

export interface Contract<P extends Procedures = Procedures, E extends Events = Events> {
  namespace: string;
  procedures: P;
  /** 主进程推送的事件；与过程同名的事件推送该过程的最新结果（docs/adr/0017）。 */
  events: E;
}

type Procedure<C extends Contract, K extends keyof C['procedures']> = C['procedures'][K];

export type Handlers<C extends Contract> = {
  [K in keyof C['procedures']]: (
    input: z.output<Procedure<C, K>['input']>,
  ) => z.output<Procedure<C, K>['output']> | Promise<z.output<Procedure<C, K>['output']>>;
};

export type Client<C extends Contract> = {
  [K in keyof C['procedures']]: (
    ...input: undefined extends z.input<Procedure<C, K>['input']>
      ? [input?: z.input<Procedure<C, K>['input']>]
      : [input: z.input<Procedure<C, K>['input']>]
  ) => Promise<z.output<Procedure<C, K>['output']>>;
};

/** 擦除了具体类型的实现，app 只需要通道名和一个统一的调用入口。 */
export interface Implementation {
  contract: Contract;
  call(name: string, input: unknown): unknown;
}

export type EventPayload<C extends Contract, K extends keyof C['events']> = z.output<
  C['events'][K]
>;

/** preload 暴露给渲染端的唯一入口，只放行已登记契约的通道。 */
export interface Bridge {
  invoke(channel: string, input: unknown): Promise<unknown>;
  /** 订阅推送事件，返回退订函数。 */
  subscribe(channel: string, listener: (payload: unknown) => void): () => void;
}

export function defineContract<const P extends Procedures, const E extends Events = {}>(
  namespace: string,
  procedures: P,
  events: E = {} as E,
): Contract<P, E> {
  return { namespace, procedures, events };
}

export function channelsOf(contract: Contract): string[] {
  return Object.keys(contract.procedures).map((name) => `${contract.namespace}:${name}`);
}

export function eventChannelsOf(contract: Contract): string[] {
  return Object.keys(contract.events).map((name) => `${contract.namespace}:${name}`);
}

export function subscribe<C extends Contract, K extends keyof C['events'] & string>(
  contract: C,
  bridge: Bridge | undefined,
  name: K,
  listener: (payload: EventPayload<C, K>) => void,
): () => void {
  if (!bridge) return () => {};
  return bridge.subscribe(`${contract.namespace}:${name}`, (payload) =>
    listener(payload as EventPayload<C, K>),
  );
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

/** 契约客户端抛出的错误已去掉 Electron 前缀，直接作为提示文案。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
