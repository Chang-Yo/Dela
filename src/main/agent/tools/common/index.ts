import { editNoteTool } from './edit-note';
import { writeNoteTool } from './edit';
import { editFileTool, readFileTool, writeFileTool } from './files';
import { readResourceTool } from './read-resource';
import { readSkillFileTool, readSkillTool } from './skill-read';
import { shellCancelTool, shellPollTool, shellTool } from './shell';

export const commonTools = {
  read_resource: readResourceTool,
  write_note: writeNoteTool,
  edit_note: editNoteTool,
  read_skill: readSkillTool,
  read_skill_file: readSkillFileTool,
};

export const fileTools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
};

export const shellTools = {
  shell: shellTool,
  shell_poll: shellPollTool,
  shell_cancel: shellCancelTool,
};
