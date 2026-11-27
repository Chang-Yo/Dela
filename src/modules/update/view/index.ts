import { defineView } from '../../../app/module';
import { startUpdateMirror } from './update';
export { onUpdateEvent, updateClient } from './client';
export { ReleaseNotesDialog } from './ReleaseNotesDialog';
export { UpdateBadge } from './UpdateBadge';
export { UpdateControl } from './UpdateControl';
export { UpdatePrompt } from './UpdatePrompt';
export { deferInstall, runUpdateAction, useUpdateState } from './update';

export const updateView = defineView({ pages: {}, start: startUpdateMirror });
