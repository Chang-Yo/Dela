// 应用内更新的渲染端出口：标题栏角标、下载完成弹窗、设置里的更新控件与更新内容弹窗。
import { defineView } from '../../../app/module';
import { startUpdateMirror } from './update';
export { onUpdateEvent, updateClient } from './client';
export { ReleaseNotesDialog } from './ReleaseNotesDialog';
export { UpdateBadge } from './UpdateBadge';
export { UpdateControl } from './UpdateControl';
export { UpdatePrompt } from './UpdatePrompt';
export { useUpdateState } from './update';

export const updateView = defineView({ pages: {}, start: startUpdateMirror });
