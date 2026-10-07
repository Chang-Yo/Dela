import type { VsjtuVideo } from '../../../shared/api';
import { AddToProjectDialogBase } from '../../workspace/add-to-project-dialog';
import { useVideos } from './store';

/**
 * 把当前场次作为来源引用添加到项目/文件夹：先写 vsjtu_video_refs 引用行
 * （只存元数据，播放直链不入库），再建 workspace source 条目（vsjtu-video:<id>）。
 */
export function AddToProjectDialog({
  open,
  onClose,
  video,
}: {
  open: boolean;
  onClose: () => void;
  video: VsjtuVideo;
}) {
  const courses = useVideos((state) => state.courses);
  const courseName =
    courses.find((course) => course.teclId === video.teclId)?.subjName ?? '课堂视频';
  const title = [
    courseName,
    video.beginTime.slice(0, 10),
    video.letiNumber !== null ? `第${video.letiNumber}节` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <AddToProjectDialogBase
      open={open}
      onClose={onClose}
      description={`引用「${title}」，视频保持在交大视频平台不变。`}
      subject={title}
      sourceId={`vsjtu-video:${video.courseId}`}
      writeRef={async () => {
        await window.dela!.vsjtu.addSourceRef(video.courseId);
      }}
    />
  );
}
