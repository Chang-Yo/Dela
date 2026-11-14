// 课堂视频回看（v.sjtu.edu.cn）：复用校园登录会话，已连接 Canvas 时可免手动登录。
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { implement } from '../../core/protocol/contract';
import { workspaceWindow } from '../../main/ipc';
import { registerPreviewHost } from '../../main/workspace/preview';
import { savedVideoDownloadDirectory } from '../../main/settings/prefs';
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
} from './main/downloads';
import { handleVsjtuMediaRequest, issuePlayback } from './main/playback';

export const classroomModule = defineModule({
  id: 'classroom',
  ipc: implement(classroomContract, {
    connect: () => connectClassroom(workspaceWindow()!.webContents),
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
    registerCommandDomain(classroomDomain);
    registerPreviewHost('vsjtu', handleVsjtuMediaRequest);
  },
});
