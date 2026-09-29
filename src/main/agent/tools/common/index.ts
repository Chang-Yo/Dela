import { editNoteTool } from './edit-note';
import { writeNoteTool } from './edit';
import { readResourceTool } from './read-resource';

export const commonTools = {
  read_resource: readResourceTool,
  write_note: writeNoteTool,
  edit_note: editNoteTool,
};
