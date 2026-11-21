// 课堂视频回看（v.sjtu.edu.cn）：复用校园登录会话，已连接 Canvas 时可免手动登录。
import type { WebContents } from 'electron';
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { hostPorts } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { registerPreviewHost } from '../../modules/workspace';
import { registerSettingsSearch } from '../../modules/settings';
import { classroomContract } from './contract';
import { classroomDomain } from './main/agent';
import { connectClassroom, getTranscript, listCourses, listVideos } from './main/api';
import {
  cancelDownload,
  chooseDownloadDirectory,
  downloadVideo,
  exportTranscript,
  listDownloads,
  revealDownload,
  savedVideoDownloadDirectory,
} from './main/downloads';
import { handleVsjtuMediaRequest, issuePlayback } from './main/playback';

export const classroomModule = defineModule({
  id: 'classroom',
  ipc: implement(classroomContract, {
    connect: () => connectClassroom(hostPorts().workspaceClient() as WebContents),
    courses: listCourses,
    videos: listVideos,
    streams: issuePlayback,
    transcript: getTranscript,
    exportTranscript: ({ videoId, title }) => exportTranscript(videoId, title),
    download: ({ videoId, view, name }) => downloadVideo(videoId, view, name),
    downloads: listDownloads,
    cancelDownload,
    revealDownload,
    downloadDirectory: savedVideoDownloadDirectory,
    chooseDownloadDirectory,
  }),
  register() {
    registerSettingsSearch({
      id: 'video-download-directory',
      section: 'storage',
      title: '视频默认下载目录',
      keywords: ['课堂', '录像', '下载', '目录', '交大视频', 'vsjtu', 'classroom', 'download'],
    });
    registerCommandDomain(classroomDomain);
    registerPreviewHost('vsjtu', handleVsjtuMediaRequest);
  },
});
