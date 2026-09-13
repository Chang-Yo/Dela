import { ProjectView } from '../projects/ProjectView';

export function SourcesView({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  return <ProjectView mode="sources" onOpenProject={onOpenProject} />;
}
