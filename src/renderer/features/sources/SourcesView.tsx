import { ProjectView } from '../projects/ProjectView';

export function SourcesView({
  onOpenProject,
  onOpenShuiyuanTopic,
  chatRequest,
}: {
  onOpenProject: (id: string) => void;
  onOpenShuiyuanTopic?: (topicId: number, postNumber?: number) => void;
  chatRequest?: { sessionId: string };
}) {
  return (
    <ProjectView
      mode="sources"
      chatRequest={chatRequest}
      onOpenProject={onOpenProject}
      onOpenShuiyuanTopic={onOpenShuiyuanTopic}
    />
  );
}
