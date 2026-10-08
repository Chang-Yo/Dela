/** Composer 发送载荷：markdown 文本（内联图片以 dela-img token 嵌入）、暂存附件与 @ 引用。 */
export interface ChatAskInput {
  text: string;
  attachments: string[];
  context: string[];
  /** 编辑重发：丢弃会话中最后一条用户消息及其后内容，以 text 重新发起。 */
  replaceLastUser?: boolean;
}

/** 暂存到主进程的图片/附件：图片持久化到磁盘供历史展示，附件发送后即释放。 */
export interface ChatMediaView {
  id: string;
  name: string;
  size: number;
  kind: 'image' | 'attachment';
  /** 图片的缩略预览 data URL；附件为 null。 */
  previewUrl: string | null;
}

export interface ChatCommandView {
  id: string;
  name: string;
  prompt: string;
}

export interface ChatApi {
  stageMedia(input: { name: string; bytes: ArrayBuffer | Uint8Array }): Promise<ChatMediaView>;
  pickMedia(): Promise<ChatMediaView[]>;
  /** 已发送图片的缩略预览；附件或文件缺失时为 null。 */
  readMediaPreview(id: string): Promise<string | null>;
  /** 移除尚未发送的暂存文件（composer 删除 chip、离开视图清理草稿）。 */
  releaseMedia(ids: readonly string[]): void;
  listCommands(): Promise<ChatCommandView[]>;
  saveCommand(input: { id?: string; name: string; prompt: string }): Promise<ChatCommandView>;
  deleteCommand(id: string): void;
}
