import { chatImageToken } from '../../shared/chat-input';
import type { ChatMediaView } from '../../shared/chat';
import type { WorkspaceChat } from '../../shared/api';
import { useNavigationStore } from '../navigation/view';
import { useSessions } from '../sessions/store';

export interface StudyChatResult {
  sessionId: string;
  projectId: string | null;
}

export async function sendStudyChat(input: {
  prompt: string;
  images?: { name: string; bytes: ArrayBuffer }[];
  sessionKey?: string;
  onSession?: (session: StudyChatResult) => void;
}): Promise<StudyChatResult> {
  if (!window.dela) throw new Error('当前页面无法打开学习对话');
  const navigation = useNavigationStore.getState();
  const projectId = navigation.view === 'workbench' ? navigation.projectId : null;
  const storageKey = `dela.study-session:${projectId ?? 'global'}:${input.sessionKey ?? 'default'}`;
  let chat: WorkspaceChat | null = null;
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) chat = await window.dela.session.open(existing);
  } catch {
    // 会话可能已被删除或本地存储不可用，下面创建一个新的学习会话。
  }
  chat ??= await window.dela.session.create(projectId, projectId ? 'library' : 'chat');
  if (!chat.sessionId) throw new Error('学习对话创建失败');
  const session = { sessionId: chat.sessionId, projectId };
  useSessions.getState().putChat(chat.sessionId, chat);
  input.onSession?.(session);
  const media: ChatMediaView[] = [];
  try {
    let images = input.images ?? [];
    let visionFallback = false;
    try {
      const providers = await window.dela.llm.list();
      const active = providers.find((provider) => provider.active);
      if (images.length && active?.modelConfigs?.[active.model]?.vision === false) {
        images = [];
        visionFallback = true;
      }
    } catch {
      // 未能读取模型设置时继续发送；主进程仍会按模型能力返回明确错误。
    }
    for (const image of images)
      media.push(await window.dela.chat.stageMedia({ name: image.name, bytes: image.bytes }));
    const text = [
      input.prompt,
      visionFallback ? '当前模型未启用图片输入，本次只发送文字和字幕上下文。' : '',
      media.length ? media.map((item) => chatImageToken(item.id, item.name)).join('\n') : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const result = await window.dela.session.ask(chat.sessionId, {
      text,
      // 图像必须走 dela-img token，attachments 通道只用于文档/文本附件。
      attachments: [],
      context: [],
    });
    try {
      localStorage.setItem(storageKey, chat.sessionId);
    } catch {
      /* 会话仍然保留在历史里，本地存储失败只影响自动恢复。 */
    }
    useSessions.getState().putChat(result.sessionId!, result);
    void useSessions
      .getState()
      .refresh(projectId)
      .catch(() => {});
    return { sessionId: result.sessionId!, projectId };
  } catch (error) {
    if (media.length) window.dela.chat.releaseMedia(media.map((item) => item.id));
    throw error;
  }
}

export async function openStudyChat(input: {
  prompt: string;
  images?: { name: string; bytes: ArrayBuffer }[];
  sessionKey?: string;
}): Promise<void> {
  const result = await sendStudyChat(input);
  useNavigationStore.getState().openChat(result.sessionId, result.projectId);
}

export async function canvasBytes(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('当前页面无法生成截图'))),
      'image/png',
    ),
  );
  return blob.arrayBuffer();
}
