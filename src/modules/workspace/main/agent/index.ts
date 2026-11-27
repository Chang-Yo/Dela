import type { CommandDomain } from '../../../../core/capabilities/commands';
import { copyFileToProjectTool } from './copy-file';
import { createEntryTool, removeEntryTool, updateEntryTool } from './entries';
import { listWorkspaceEntriesTool } from './list-entries';

export const workspaceDomain = {
  name: 'workspace',
  description: '管理项目、关联校园资料与导入附件；普通文件用 read/write/edit/shell',
  commands: {
    list_workspace_entries: listWorkspaceEntriesTool,
    create_entry: createEntryTool,
    update_entry: updateEntryTool,
    remove_entry: removeEntryTool,
    copy_file_to_project: copyFileToProjectTool,
  },
} satisfies CommandDomain;
