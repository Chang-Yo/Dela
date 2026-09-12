import { useEffect, useState, type CSSProperties } from 'react';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { Resizer } from '../../components/ui/resizer';
import { cn } from '../../lib/utils';
import { AgentPanel } from './AgentPanel';
import { ProjectDocument } from './ProjectDocument';
import { ProjectSidebar } from './ProjectSidebar';

type ProjectViewProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
};

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* Storage may be unavailable. */
  }
}

export function ProjectView({ activeTab, onTabChange }: ProjectViewProps) {
  const [agentWidth, setAgentWidth] = useState(340);
  const [agentCollapsed, setAgentCollapsed] = useState(() =>
    readFlag('dela.project.agent-collapsed'),
  );
  const [itemsCollapsed, setItemsCollapsed] = useState(() =>
    readFlag('dela.project.items-collapsed'),
  );
  const [agentResizing, setAgentResizing] = useState(false);

  useEffect(() => writeFlag('dela.project.agent-collapsed', agentCollapsed), [agentCollapsed]);
  useEffect(() => writeFlag('dela.project.items-collapsed', itemsCollapsed), [itemsCollapsed]);

  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 grid-cols-[var(--items-width)_minmax(360px,1fr)_var(--agent-area)] overflow-hidden bg-card transition-[grid-template-columns] duration-150 ease-out max-[1140px]:grid-cols-[var(--items-width)_minmax(350px,1fr)] max-md:block max-md:overflow-auto',
        agentResizing && 'transition-none',
      )}
      style={
        {
          '--items-width': itemsCollapsed ? '48px' : '178px',
          '--agent-area': agentCollapsed ? '0px' : `1px minmax(280px, ${agentWidth}px)`,
        } as CSSProperties
      }
    >
      <ProjectSidebar
        activeTab={activeTab}
        collapsed={itemsCollapsed}
        onTabChange={onTabChange}
        onToggleCollapsed={() => setItemsCollapsed((value) => !value)}
      />
      <ProjectDocument
        activeTab={activeTab}
        agentCollapsed={agentCollapsed}
        onExpandAgent={() => setAgentCollapsed(false)}
        onTabChange={onTabChange}
      />
      {!agentCollapsed && (
        <Resizer
          className="max-[1140px]:hidden"
          direction={-1}
          label="调整 Agent 面板宽度"
          max={520}
          min={280}
          onChange={setAgentWidth}
          onResizingChange={setAgentResizing}
          value={agentWidth}
        />
      )}
      {!agentCollapsed && <AgentPanel onCollapse={() => setAgentCollapsed(true)} />}
    </div>
  );
}
