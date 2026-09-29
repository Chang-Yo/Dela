import type { TabId } from '../../../shared/layout';

/**
 * 修改审阅标签的最小占位：人与 Agent 操作同一份文档时的差异呈现、应用与恢复
 * （docs/agent-workspace-plan.md §6.2）随文档协作阶段细化。在此之前不提供任何
 * 假动作入口；main 侧 edit_note/note_versions 已就绪，呈现层后续接入。
 */
export function ReviewTab({ tabId }: { tabId: TabId; groupId: string }) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={`修改审阅：${tabId}`}
    >
      <div
        role="status"
        className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground"
      >
        修改审阅将在此呈现
      </div>
    </section>
  );
}
