// 工具表公共出口：内核工具（kernel/）与 dela 命令（commands.ts）。
// 校园与工作区业务不进模型工具表，经 Bash 的 dela 命令调用。
export { agentTools, kernelTools, toolDomains } from './kernel';
export type { ToolDomain } from './kernel';
