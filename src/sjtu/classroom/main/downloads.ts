// 录像下载与文稿导出：都经原生保存对话框写到用户选的位置；对话框挂在工作区窗口上。
import { app, dialog, shell, type DownloadItem, type SaveDialogOptions } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { emit } from '../../../core/ports';
import { workspaceWindow } from '../../../main/ipc';
import {
  savedVideoDownloadDirectory,
  setVideoDownloadDirectory,
} from '../../../main/settings/prefs';
import { getCampusSession } from '../../campus/main/session';
import { classroomContract, type VideoDownload } from '../contract';
import { getStreams, getTranscript, formatTranscript } from './api';
import { safeFileName } from './transcript';

const downloads = new Map<string, { info: VideoDownload; item: DownloadItem; path: string }>();
const pending = new Set<string>();

function showSaveDialog(options: SaveDialogOptions) {
  const parent = workspaceWindow();
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
}

export function listDownloads(): VideoDownload[] {
  return [...downloads.values()].map((download) => download.info);
}

export async function downloadVideo(
  videoId: number,
  view: number,
  suggestedName: string,
): Promise<void> {
  const key = `${videoId}/${view}`;
  if (pending.has(key) || downloads.get(key)?.info.state === 'progressing')
    throw new Error('该画面正在下载');
  pending.add(key);
  try {
    const name = `${safeFileName(suggestedName) || videoId}-画面${view}.mp4`;
    const directory = savedVideoDownloadDirectory();
    const selected = await showSaveDialog({
      title: '下载课堂视频',
      defaultPath: directory ? join(directory, name) : name,
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
    });
    if (selected.canceled || !selected.filePath) return;
    const stream = (await getStreams(videoId)).find((stream) => stream.view === view);
    if (!stream) throw new Error('该画面暂不可用');
    const target = stream.url;
    const campus = await getCampusSession();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        campus.removeListener('will-download', listener);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('下载启动超时，请重试'));
      }, 20000);
      const listener = (_event: Electron.Event, item: DownloadItem) => {
        if (item.getURL() !== target) return;
        cleanup();
        item.setSavePath(selected.filePath!);
        const download = {
          info: {
            id: key,
            name,
            received: 0,
            total: item.getTotalBytes(),
            state: 'progressing' as VideoDownload['state'],
          },
          item,
          path: selected.filePath!,
        };
        downloads.set(key, download);
        const update = (state: VideoDownload['state']) => {
          const ended =
            state !== download.info.state && (state === 'completed' || state === 'interrupted');
          download.info = {
            ...download.info,
            received: item.getReceivedBytes(),
            total: item.getTotalBytes(),
            state,
          };
          emit(classroomContract, 'downloads', listDownloads());
          if (ended) emit(classroomContract, 'downloadEnded', download.info);
        };
        let interrupted = false;
        item.on('updated', (_event, state) => {
          update(state);
          // 首版不承诺跨链接续传，中断后由用户重新下载。
          if (state === 'interrupted') {
            interrupted = true;
            item.cancel();
          }
        });
        item.once('done', (_event, state) => update(interrupted ? 'interrupted' : state));
        emit(classroomContract, 'downloads', listDownloads());
        resolve();
      };
      campus.on('will-download', listener);
      try {
        campus.downloadURL(target);
      } catch {
        cleanup();
        reject(new Error('无法启动视频下载'));
      }
    });
  } finally {
    pending.delete(key);
  }
}

export function cancelDownload(key: string): void {
  downloads.get(key)?.item.cancel();
}

export function revealDownload(key: string): void {
  const download = downloads.get(key);
  if (download?.info.state === 'completed') shell.showItemInFolder(download.path);
}

export async function chooseDownloadDirectory(): Promise<string> {
  const result = await dialog.showOpenDialog({
    title: '课堂录像的默认保存位置（每次下载仍可在保存对话框里改）',
    defaultPath: savedVideoDownloadDirectory() || app.getPath('videos'),
    properties: ['openDirectory', 'createDirectory'],
  });
  const path = result.filePaths[0];
  if (result.canceled || !path) return savedVideoDownloadDirectory();
  return setVideoDownloadDirectory(path);
}

export async function exportTranscript(videoId: number, title: string) {
  const transcript = await getTranscript(videoId);
  if (!transcript) throw new Error('该录像暂无语音文稿');
  const selected = await showSaveDialog({
    title: '导出语音文稿',
    defaultPath: `${safeFileName(title)}-${videoId}.txt`,
    filters: [{ name: '文本文件', extensions: ['txt'] }],
  });
  if (selected.canceled || !selected.filePath) return { saved: false };
  await writeFile(selected.filePath, formatTranscript(transcript, title), 'utf8');
  return { saved: true };
}
