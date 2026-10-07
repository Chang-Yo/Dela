import { AddToProjectDialogBase } from '../../workspace/add-to-project-dialog';

/**
 * 把当前帖子作为来源引用添加到项目/文件夹：先写 shuiyuan_topics 引用行，
 * 再建 workspace source 条目（sourceId 形如 shuiyuan-topic:<id>）。
 */
export function AddToProjectDialog({
  open,
  onClose,
  topicId,
  topicTitle,
}: {
  open: boolean;
  onClose: () => void;
  topicId: number | null;
  topicTitle: string;
}) {
  return (
    <AddToProjectDialogBase
      open={open}
      onClose={onClose}
      description={`引用「${topicTitle || '该帖子'}」，原帖保持在水源不变。`}
      subject={topicTitle}
      sourceId={topicId === null ? '' : `shuiyuan-topic:${topicId}`}
      writeRef={
        topicId === null
          ? null
          : async () => {
              await window.dela!.shuiyuan.addSourceRef(topicId);
            }
      }
    />
  );
}
