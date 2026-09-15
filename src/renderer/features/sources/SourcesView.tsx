import { ProjectView } from '../projects/ProjectView';

export function SourcesView({
  onOpenProject,
  onOpenShuiyuanTopic,
}: {
  onOpenProject: (id: string) => void;
  onOpenShuiyuanTopic?: (topicId: number) => void;
}) {
  return (
    <ProjectView
      mode="sources"
      onOpenProject={onOpenProject}
      onOpenShuiyuanTopic={onOpenShuiyuanTopic}
    />
  );
}
