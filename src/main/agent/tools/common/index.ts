import { editNoteTool } from './edit-note';
import { writeNoteTool } from './edit';
import { readResourceTool } from './read-resource';
import { readSkillFileTool, readSkillTool } from './skill-read';

export const commonTools = {
  read_resource: readResourceTool,
  write_note: writeNoteTool,
  edit_note: editNoteTool,
  read_skill: readSkillTool,
  read_skill_file: readSkillFileTool,
};
