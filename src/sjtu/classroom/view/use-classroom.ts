import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../renderer/app/toasts';
import { classroomContract } from '../contract';
import { useClassroom } from './store';

export const classroomClient = createClient(classroomContract, window.dela?.bridge);

/** 读取失败时提示原因；已有课程时页面保留旧列表，没有时退回登录卡。 */
export function useCourses() {
  return useQuery({
    queryKey: ['classroom', 'courses'],
    queryFn: async () => {
      try {
        return await classroomClient.courses();
      } catch (error) {
        showToast({ variant: 'error', title: '课程加载失败', description: errorMessage(error) });
        throw error;
      }
    },
  });
}

// 录像、画面与文稿在本次运行内不变，重新登录时随 ['classroom'] 一起重读。
export function useVideos(courseId: number | undefined) {
  return useQuery({
    queryKey: ['classroom', 'videos', courseId],
    queryFn: () => classroomClient.videos(courseId!),
    enabled: courseId !== undefined,
    staleTime: Infinity,
  });
}

export function useStreams(videoId: number) {
  return useQuery({
    queryKey: ['classroom', 'streams', videoId],
    queryFn: () => classroomClient.streams(videoId),
    staleTime: Infinity,
  });
}

export function useTranscript(videoId: number) {
  return useQuery({
    queryKey: ['classroom', 'transcript', videoId],
    queryFn: () => classroomClient.transcript(videoId),
    staleTime: Infinity,
  });
}

export function useDownloads() {
  return useQuery({
    queryKey: ['classroom', 'downloads'],
    queryFn: () => classroomClient.downloads(),
  });
}

/** 当前课程默认取第一门；选中的课程不在列表里时同样回到第一门。 */
export function useSelection() {
  const courses = useCourses().data ?? [];
  const courseId = useClassroom((state) => state.courseId);
  const videoId = useClassroom((state) => state.videoId);
  const course = courses.find((course) => course.id === courseId) ?? courses[0];
  const videos = useVideos(course?.id);
  return { course, videos, video: videos.data?.find((video) => video.id === videoId) };
}

export function useConnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await classroomClient.connect();
      if (!result.ok) throw new Error(result.error);
    },
    // 不等重读：登录窗口关闭后按钮即从「等待登录」转为「正在获取视频列表」。
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['classroom'] }),
    onError: (error) =>
      showToast({ variant: 'error', title: '登录未完成', description: errorMessage(error) }),
  });
}
