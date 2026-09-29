/**
 * Pi 系包是纯 ESM（exports 无 require 条件），主进程 CJS 产物静态 require 会抛
 * ERR_PACKAGE_PATH_NOT_EXPORTED。执行核心对它们的值引用统一经此动态加载并缓存；
 * 类型引用在构建时擦除，不受影响。capabilities/mcp.ts 对 pi-mcp 同理。
 */
export interface PiRuntime {
  Agent: typeof import('@earendil-works/pi-agent-core').Agent;
  clampThinkingLevel: typeof import('@earendil-works/pi-ai').clampThinkingLevel;
  createAssistantMessageEventStream: typeof import('@earendil-works/pi-ai').createAssistantMessageEventStream;
  openAiCompletionsStream: typeof import('@earendil-works/pi-ai/api/openai-completions').stream;
}

let cached: Promise<PiRuntime> | undefined;

export function loadPiRuntime(): Promise<PiRuntime> {
  cached ??= (async () => {
    const [agentCore, piAi, completions] = await Promise.all([
      import('@earendil-works/pi-agent-core'),
      import('@earendil-works/pi-ai'),
      import('@earendil-works/pi-ai/api/openai-completions'),
    ]);
    return {
      Agent: agentCore.Agent,
      clampThinkingLevel: piAi.clampThinkingLevel,
      createAssistantMessageEventStream: piAi.createAssistantMessageEventStream,
      openAiCompletionsStream: completions.stream,
    };
  })();
  return cached;
}
