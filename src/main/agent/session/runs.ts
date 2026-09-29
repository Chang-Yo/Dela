// Run 语义初版（阶段二在 session/runs 实体化为持久记录）：每个 scope 至多一个在途执行。
export const asking = new Map<string, { controller: AbortController; tool?: string }>();
